import { HalfBeatQueue } from './half-beat-queue.mjs';
import { MIX, createOutputChain } from './mix.mjs';

export class AudioEngine {
  constructor(catalog, resources, getSettings, onState, onScheduled) {
    this.catalog = catalog; this.resources = resources; this.getSettings = getSettings;
    this.onState = onState; this.onScheduled = onScheduled;
    this.state = 'idle'; this.promise = null; this.ctx = null; this.buffers = new Map();
    this.voices = new Map(); this.fading = new Set(); this.queue = new HalfBeatQueue();
    this.serial = 0; this.contextsCreated = 0; this.lastSample = null; this.history = [];
    this.scheduledSlots = new Map();
  }
  setState(state) { this.state = state; this.onState?.(state); }
  async initialize() {
    if (this.promise) return this.promise;
    if (this.state === 'running' || this.state === 'paused') return;
    this.setState('loading');
    this.promise = (async () => {
      try {
        const Constructor = window.AudioContext || window.webkitAudioContext;
        if (!Constructor) throw Error('Web Audio unavailable');
        this.ctx = new Constructor({ latencyHint: 'interactive' }); this.contextsCreated++;
        const ctx = this.ctx;
        Object.assign(this, createOutputChain(ctx, ctx.destination)); this.master.gain.value = 0;
        this.musicBus = ctx.createGain(); this.voiceBus = ctx.createGain(); this.lastDuckTarget = undefined;
        this.musicBus.connect(this.master); this.voiceBus.connect(this.master);
        await ctx.resume();
        const decode = async file => {
          if (window.__TEST_FAIL_RESOURCE === file) throw Error(`Injected resource failure: ${file}`);
          return ctx.decodeAudioData(this.resources.bytes(file).buffer);
        };
        const results = await Promise.allSettled([decode(this.catalog.music.file), ...this.catalog.voices.map(v => decode(v.file))]);
        if (results[0].status !== 'fulfilled') throw results[0].reason;
        this.musicBuffer = results[0].value; this.buffers.clear(); this.failedVoices = [];
        for (let i = 0; i < this.catalog.voices.length; i++) {
          const voice = this.catalog.voices[i], result = results[i + 1];
          if (result.status === 'fulfilled') this.buffers.set(voice.id, result.value);
          else this.failedVoices.push(voice.id);
        }
        if (!this.buffers.size) throw Error('No playable voice samples');
        this.setState('ready');
        this.applyVolumes();
        this.startTransport();
      } catch (error) {
        this.queue.clear(); this.stopSources();
        if (this.ctx && this.ctx.state !== 'closed') await this.ctx.close().catch(() => {});
        this.ctx = null; this.buffers.clear(); this.setState('error'); throw error;
      }
    })();
    try { return await this.promise; } finally { this.promise = null; }
  }
  startTransport() {
    const ctx = this.ctx, settings = this.getSettings();
    if (!ctx || ctx.state === 'closed') return;
    this.stopMusic(); this.queue.clear();
    this.musicStart = ctx.currentTime + 0.06;
    const loopStart = Math.min(settings.beatOffset, this.musicBuffer.duration - 1);
    const bar = 240 / settings.bpm;
    this.loopLength = Math.max(bar, Math.floor((this.musicBuffer.duration - loopStart) / bar) * bar);
    this.loopEnd = Math.min(this.musicBuffer.duration, loopStart + this.loopLength);
    this.loopLength = this.loopEnd - loopStart;
    this.origin = this.musicStart + loopStart;
    this.musicSource = ctx.createBufferSource(); this.musicSource.buffer = this.musicBuffer;
    this.musicSource.loop = true; this.musicSource.loopStart = loopStart; this.musicSource.loopEnd = this.loopEnd;
    this.loopEnvelope = ctx.createGain(); this.loopEnvelope.gain.value = 1;
    this.musicSource.connect(this.loopEnvelope); this.loopEnvelope.connect(this.musicBus);
    this.musicSource.start(this.musicStart, 0); this.lastLoopBoundary = 0;
    clearInterval(this.timer); this.timer = setInterval(() => this.tick(), 12);
    this.setState('running'); this.applyVolumes();
  }
  choose() {
    const pool = this.getSettings().pool;
    const decoded = ['running', 'ready', 'paused'].includes(this.state);
    const eligible = this.catalog.voices.filter(v => v.pools.includes(pool) && (!decoded || this.buffers.has(v.id)));
    if (!eligible.length) return null;
    const fresh = eligible.filter(v => v.id !== this.lastSample);
    const choices = fresh.length ? fresh : eligible;
    return choices[Math.floor(Math.random() * choices.length)];
  }
  request(sample, inputId, point) {
    if (this.state !== 'running' || !sample || !this.buffers.has(sample.id)) return null;
    const entry = this.queue.push({ id: ++this.serial, sampleId: sample.id, inputId, point, rate: 1 }, this.ctx.currentTime, this.origin, this.getSettings().bpm);
    this.tick(); return entry;
  }
  tick() {
    if (this.state !== 'running' || this.ctx?.state !== 'running') return;
    const now = this.ctx.currentTime;
    for (const event of this.queue.take(now, 0.075)) this.play(event);
    const boundaryIndex = Math.max(1, Math.ceil((now - this.origin) / this.loopLength));
    const boundary = this.origin + boundaryIndex * this.loopLength;
    if (boundary < now + 0.15 && boundaryIndex !== this.lastLoopBoundary) {
      const gain = this.loopEnvelope.gain;
      gain.setValueAtTime(1, Math.max(now, boundary - 0.006));
      gain.linearRampToValueAtTime(0, boundary); gain.linearRampToValueAtTime(1, boundary + 0.006);
      this.lastLoopBoundary = boundaryIndex;
    }
    this.updateDucking();
  }
  play(event) {
    const sample = this.catalog.voices.find(v => v.id === event.sampleId), buffer = this.buffers.get(event.sampleId);
    if (!sample || !buffer) return;
    const ctx = this.ctx, onset = sample.onsetOffset || 0;
    const sourceStart = Math.max(ctx.currentTime, event.when - onset), when = sourceStart + onset;
    const replaced = this.scheduledSlots.get(event.slot);
    if (replaced && replaced.sourceStart > ctx.currentTime) {
      this.stopVoice(replaced, ctx.currentTime, true);
    }
    while (this.voices.size >= 4) this.stopVoice(this.voices.values().next().value, when);
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = buffer; source.playbackRate.value = 1;
    gain.gain.setValueAtTime(0, sourceStart); gain.gain.linearRampToValueAtTime(sample.gain, sourceStart + Math.min(0.003, onset || 0.003));
    gain.gain.setValueAtTime(sample.gain, Math.max(sourceStart + 0.003, sourceStart + buffer.duration - 0.008));
    gain.gain.linearRampToValueAtTime(0, sourceStart + buffer.duration);
    source.connect(gain); gain.connect(this.voiceBus);
    const voice = { id: event.id, slot: event.slot, inputId: event.inputId, point: event.point, sample, source, gain, start: when, sourceStart, end: sourceStart + buffer.duration, rate: 1, stopping: false };
    this.voices.set(voice.id, voice); this.lastSample = sample.id;
    this.scheduledSlots.set(event.slot, voice);
    source.onended = () => { this.voices.delete(voice.id); this.fading.delete(voice); if (this.scheduledSlots.get(event.slot) === voice) this.scheduledSlots.delete(event.slot); source.disconnect(); gain.disconnect(); };
    source.start(sourceStart);
    const record = { id: voice.id, sampleId: sample.id, when, sourceStart, onsetOffset: onset, requestedWhen: event.when, gridErrorMs: (when - event.when) * 1000, slot: event.slot, origin: this.origin, bpm: this.getSettings().bpm };
    this.history.push(record); if (this.history.length > 100) this.history.shift();
    this.onScheduled?.(voice, record); this.updateDucking(when);
  }
  stopVoice(voice, when = this.ctx?.currentTime ?? 0, immediate = false) {
    if (!voice || voice.stopping) return;
    if (when < voice.sourceStart) { this.onCancelled?.(voice); this.history = this.history.filter(record => record.id !== voice.id); }
    voice.stopping = true; this.voices.delete(voice.id); this.fading.add(voice);
    try {
      voice.gain.gain.cancelScheduledValues(when);
      voice.gain.gain.setValueAtTime(Math.min(voice.sample.gain, Math.max(0, voice.gain.gain.value)), when);
      voice.gain.gain.linearRampToValueAtTime(0, when + (immediate ? 0 : 0.024));
      voice.source.stop(when + (immediate ? 0 : 0.025));
      if (immediate) { voice.source.disconnect(); voice.gain.disconnect(); this.fading.delete(voice); }
    } catch { this.fading.delete(voice); }
  }
  cancelInputs(stopAudio = true) {
    this.queue.clear();
    if (stopAudio) for (const voice of [...this.voices.values()]) this.stopVoice(voice);
  }
  cancelPointer(inputId) {
    this.queue.cancel(inputId);
    for (const voice of [...this.voices.values()]) if (voice.inputId === inputId) this.stopVoice(voice);
  }
  stopMusic() {
    if (this.musicSource) { try { this.musicSource.stop(); } catch {} this.musicSource.disconnect(); this.musicSource = null; }
    this.loopEnvelope?.disconnect(); this.loopEnvelope = null;
  }
  stopSources() {
    clearInterval(this.timer); this.timer = null; this.stopMusic();
    for (const voice of [...this.voices.values()]) this.stopVoice(voice, this.ctx?.currentTime ?? 0, true);
    for (const voice of this.fading) { try { voice.source.stop(); } catch {} voice.source.disconnect(); voice.gain.disconnect(); }
    this.fading.clear(); this.voices.clear(); this.scheduledSlots.clear();
  }
  async pause() {
    if (this.state !== 'running') return;
    this.queue.clear(); this.stopSources(); this.setState('paused');
    await this.ctx.suspend().catch(() => {});
  }
  async resume() {
    if (this.state !== 'paused') return this.initialize();
    await this.ctx.resume(); this.startTransport();
  }
  applyVolumes() {
    if (!this.ctx || !this.master) return;
    const settings = this.getSettings(), now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now); this.voiceBus.gain.cancelScheduledValues(now); this.musicBus.gain.cancelScheduledValues(now);
    this.lastDuckTarget = undefined;
    this.master.gain.setTargetAtTime(settings.masterVolume, now, 0.012);
    this.voiceBus.gain.setTargetAtTime(settings.voiceVolume, now, 0.012);
    this.updateDucking();
  }
  updateDucking(when = this.ctx?.currentTime ?? 0) {
    if (!this.musicBus || !this.ctx) return;
    const active = [...this.voices.values()].some(v => v.start <= when + 0.025 && v.end > when);
    const duck = active ? 10 ** (MIX.duckDb / 20) : 1;
    const target = this.getSettings().musicVolume * this.catalog.music.gain * duck;
    if (Math.abs((this.lastDuckTarget ?? -1) - target) < 1e-8) return;
    this.lastDuckTarget = target;
    this.musicBus.gain.setTargetAtTime(target, when, active ? 0.018 : 0.25);
  }
  get visualTime() {
    if (!this.ctx) return 0;
    const stamp = this.ctx.getOutputTimestamp?.();
    if (stamp?.contextTime > 0 && stamp.performanceTime > 0) return Math.max(0, stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000);
    return Math.max(0, this.ctx.currentTime - (this.ctx.baseLatency || 0));
  }
  get beatPosition() { return this.ctx ? (this.visualTime - this.origin) * this.getSettings().bpm / 60 : 0; }
  get views() { return [...this.voices.values(), ...this.fading]; }
  stats() {
    return { state: this.state, contextState: this.ctx?.state ?? null, contextsCreated: this.contextsCreated, decodedVoices: this.buffers.size, failedVoices: this.failedVoices ?? [], activeVoices: this.voices.size, fadingVoices: this.fading.size, queued: this.queue.size, musicGain: this.catalog.music.gain, musicLoopSeconds: this.loopLength ?? null, bpm: this.getSettings().bpm, beatOffset: this.getSettings().beatOffset, history: [...this.history] };
  }
}
