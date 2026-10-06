import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import { musicSourceGain } from '../src/mix.mjs';
import { refineBeatGrid } from './beat-grid.mjs';
import { findVoiceOnset } from './voice-onset.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'assets/production');
fs.mkdirSync(out, { recursive: true });
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const musicSource = path.join(root, 'assets/source/music/背景音乐（缩减版）.wav');
const musicSourceSha = digest(fs.readFileSync(musicSource));
const musicIdentity = `${musicSourceSha}:bar-phase-1-v2`;
const atlasSource = path.join(root, 'assets/art/hazel-seated-atlas-v1.png');
const voiceSourceDirectory = path.join(root, 'assets/source/voice');
const selections = fs.readdirSync(voiceSourceDirectory, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')).map(entry => entry.name).sort();
if (!selections.length) throw Error('The selected voice directory contains no MP4 audio files');
// The atlas still holds eight sprites (two outfits, four states); the current build ships
// only the uniform idle one, so that frame is named here instead of being derived by row and column.
const RUNTIME_FRAMES = [{ skin: 'uniform', state: 'idle' }];

function decodeAudio(file) {
  const bytes = execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', '44100', 'pipe:1'], { maxBuffer: 128 * 1024 * 1024, windowsHide: true });
  const channels = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  const mono = new Float32Array(channels.length / 2);
  let peak = 0;
  for (let i = 0; i < mono.length; i++) {
    mono[i] = (channels[i * 2] + channels[i * 2 + 1]) / 2;
    peak = Math.max(peak, Math.abs(channels[i * 2]), Math.abs(channels[i * 2 + 1]));
  }
  const rms = [];
  for (let i = 0; i < mono.length; i += 882) {
    let sum = 0;
    const end = Math.min(mono.length, i + 882);
    for (let j = i; j < end; j++) sum += mono[j] ** 2;
    rms.push(Math.sqrt(sum / (end - i)));
  }
  const threshold = Math.max(0.002, Math.max(...rms) * 0.1);
  const active = rms.filter(v => v >= threshold);
  const loudness = Math.sqrt(active.reduce((s, v) => s + v * v, 0) / Math.max(1, active.length));
  const gain = Math.min(0.08 / Math.max(loudness, 0.001), 0.24 / Math.max(peak, 0.001), 4);
  return { mono, duration: mono.length / 44100, peak, loudness, gain, envelope: rms.map(v => Math.round(Math.min(1, v / Math.max(...rms, 0.001)) * 255)) };
}

function fftMagnitude(input) {
  const n = input.length, re = Float64Array.from(input), im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = -2 * Math.PI / length;
    for (let i = 0; i < n; i += length) {
      for (let j = 0; j < length / 2; j++) {
        const a = angle * j, cr = Math.cos(a), ci = Math.sin(a), k = i + j + length / 2;
        const tr = re[k] * cr - im[k] * ci, ti = re[k] * ci + im[k] * cr;
        re[k] = re[i + j] - tr; im[k] = im[i + j] - ti;
        re[i + j] += tr; im[i + j] += ti;
      }
    }
  }
  return Float64Array.from({ length: n / 2 }, (_, i) => Math.log1p(Math.hypot(re[i], im[i]) * 16));
}

function estimateTempo(mono) {
  const rate = 11025, hop = 128, window = 512;
  const samples = new Float32Array(Math.floor(mono.length / 4));
  for (let i = 0; i < samples.length; i++) samples[i] = (mono[i * 4] + mono[i * 4 + 1] + mono[i * 4 + 2] + mono[i * 4 + 3]) / 4;
  const flux = [], frame = new Float64Array(window);
  let previous = new Float64Array(window / 2);
  for (let i = 0; i + window <= samples.length; i += hop) {
    for (let j = 0; j < window; j++) frame[j] = samples[i + j] * (0.5 - 0.5 * Math.cos(2 * Math.PI * j / (window - 1)));
    const current = fftMagnitude(frame);
    let value = 0;
    for (let j = 2; j < 200; j++) value += Math.max(0, current[j] - previous[j]) * (j < 15 ? 1.5 : j < 80 ? 1 : 0.5);
    flux.push(value); previous = current;
  }
  const fps = rate / hop, prefix = [0];
  for (const value of flux) prefix.push(prefix.at(-1) + value);
  const onset = flux.map((value, i) => {
    const a = Math.max(0, i - 21), b = Math.min(flux.length, i + 22);
    return Math.max(0, value - (prefix[b] - prefix[a]) / (b - a));
  });
  const energy = onset.reduce((s, v) => s + v * v, 0);
  const correlations = [];
  for (let lag = Math.floor(fps * 60 / 160); lag <= Math.ceil(fps * 60 / 50); lag++) {
    let value = 0;
    for (let i = lag; i < onset.length; i++) value += onset[i] * onset[i - lag];
    correlations.push({ lag, value: value / Math.max(energy, 1e-8), bpm: 60 * fps / lag });
  }
  const peaks = correlations.filter((row, i) => i > 0 && i < correlations.length - 1 && row.value > correlations[i - 1].value && row.value >= correlations[i + 1].value);
  peaks.sort((a, b) => b.value - a.value);
  const candidates = [];
  for (const peak of peaks.slice(0, 7)) {
    let best = null;
    for (let bpm = peak.bpm * 0.985; bpm <= peak.bpm * 1.015; bpm += 0.025) {
      const period = fps * 60 / bpm;
      for (let phase = 0; phase < period; phase += 1) {
        let sum = 0, count = 0;
        for (let t = phase; t < onset.length; t += period) {
          const i = Math.floor(t), f = t - i;
          sum += (onset[i] ?? 0) * (1 - f) + (onset[i + 1] ?? 0) * f; count++;
        }
        const score = sum / Math.max(count, 1);
        if (!best || score > best.score) best = { bpm, beatOffset: phase / fps + window / 2 / rate, score, correlation: peak.value };
      }
    }
    candidates.push(best);
  }
  candidates.sort((a, b) => b.score - a.score);
  const strongest = candidates[0];
  const relaxed = candidates.find(c => c.bpm <= 120 && c.score >= (strongest?.score ?? 1) * 0.72);
  const chosen = relaxed ?? strongest ?? { bpm: 80, beatOffset: 0, score: 0, correlation: 0 };
  const fitted = refineBeatGrid(onset, fps, window / 2 / rate, chosen);
  fs.mkdirSync(path.join(root, 'assets/analysis'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets/analysis/music-beat-analysis.json'), JSON.stringify({ source: 'assets/source/music/背景音乐（缩减版）.wav', sourceSha256: musicSourceSha, barPhase: 1, phaseBasis: 'corrected user feedback: musical beat one was displayed as beat four in 0.4.0; rotate original four-beat accent by one; previous phase 2 was one beat early', initial: chosen, ...fitted }, null, 2));
  const { attacks, ...calibration } = fitted;
  return { bpm: fitted.bpm, beatOffset: fitted.beatOffset, method: 'spectral flux and autocorrelation, beat-comb phase search, robust whole-track attack regression', status: 'signal-calibrated; human audition pending', calibration, candidates: candidates.slice(0, 5).map(c => ({ bpm: Number(c.bpm.toFixed(2)), beatOffset: Number(c.beatOffset.toFixed(4)), score: Number(c.score.toFixed(4)), correlation: Number(c.correlation.toFixed(4)) })) };
}

async function prepareFrames() {
  const { data, info } = await sharp(atlasSource).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info, labels = new Uint8Array(width * height), queue = new Uint32Array(width * height), components = [];
  let nextLabel = 1;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] || data[i * 4 + 3] < 64) continue;
    let start = 0, end = 1, count = 0, minX = width, minY = height, maxX = 0, maxY = 0;
    const label = nextLabel++; if (nextLabel >= 255) break;
    queue[0] = i; labels[i] = label;
    while (start < end) {
      const index = queue[start++], x = index % width, y = Math.floor(index / width);
      count++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      for (const adjacent of [x ? index - 1 : -1, x + 1 < width ? index + 1 : -1, y ? index - width : -1, y + 1 < height ? index + width : -1]) {
        if (adjacent >= 0 && !labels[adjacent] && data[adjacent * 4 + 3] >= 64) { labels[adjacent] = label; queue[end++] = adjacent; }
      }
    }
    if (count > 10000) components.push({ label, count, minX, minY, maxX, maxY });
  }
  if (components.length < RUNTIME_FRAMES.length) throw new Error(`Atlas holds ${components.length} character sprites, need ${RUNTIME_FRAMES.length}`);
  components.sort((a, b) => a.minY - b.minY || a.minX - b.minX);
  const writeSprite = async (c, skin, state) => {
    const left = Math.max(0, c.minX - 4), top = Math.max(0, c.minY - 4);
    const w = Math.min(width, c.maxX + 5) - left, h = Math.min(height, c.maxY + 5) - top;
    const pixels = Buffer.alloc(w * h * 4);
    let headMass = 0, headX = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gx = left + x, gy = top + y, at = gy * width + gx;
      let belongs = labels[at] === c.label;
      if (!belongs && data[at * 4 + 3] > 0) {
        for (let dy = -3; dy <= 3 && !belongs; dy++) for (let dx = -3; dx <= 3 && !belongs; dx++) {
          const nx = gx + dx, ny = gy + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && labels[ny * width + nx] === c.label) belongs = true;
        }
      }
      if (!belongs) continue;
      data.copy(pixels, (y * w + x) * 4, at * 4, at * 4 + 4);
      if (y < h * 0.29) { const alpha = data[at * 4 + 3]; headMass += alpha; headX += x * alpha; }
    }
    const file = `hazel-${skin}-${state}.webp`;
    await sharp(pixels, { raw: { width: w, height: h, channels: 4 } }).webp({ lossless: true, effort: 6 }).toFile(path.join(out, file));
    return { skin, state, file, width: w, height: h, pivot: [Number((headX / headMass + w * 0.08).toFixed(2)), Number((h * 0.64).toFixed(2))], sourceRect: [left, top, w, h] };
  };
  const frames = [];
  for (const [index, { skin, state }] of RUNTIME_FRAMES.entries()) frames.push(await writeSprite(components[index], skin, state));
  return {
    source: 'assets/art/hazel-seated-atlas-v1.png',
    sourceSha256: digest(fs.readFileSync(atlasSource)),
    sourceBytes: fs.statSync(atlasSource).size,
    width, height, frames, derivation: 'connected-component atlas extraction, 3px antialias edge neighborhood, lossless WebP; source PNG kept',
  };
}

const characters = await prepareFrames();
const music = decodeAudio(musicSource), tempo = estimateTempo(music.mono);
execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', musicSource, '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', path.join(out, 'music.m4a')], { windowsHide: true });
const bar = 240 / tempo.bpm, loopStart = tempo.beatOffset;
const loopEnd = loopStart + Math.floor((music.duration - loopStart) / bar) * bar;
const voices = [];
const trimAnalysis = [];
for (let i = 0; i < selections.length; i++) {
  const relative = selections[i], source = path.join(voiceSourceDirectory, relative);
  const originalAudio = decodeAudio(source), onset = findVoiceOnset(originalAudio.mono);
  const id = `v${String(i + 1).padStart(2, '0')}`, file = `${id}.flac`;
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', source, '-vn', '-af', `aresample=44100,atrim=start_sample=${onset.trimFrame},asetpts=PTS-STARTPTS`, '-ar', '44100', '-ac', '2', '-c:a', 'flac', '-sample_fmt', 's32', '-compression_level', '8', path.join(out, file)], { windowsHide: true });
  const a = decodeAudio(path.join(out, file)), bytes = fs.readFileSync(path.join(out, file));
  if (a.mono.length !== originalAudio.mono.length - onset.trimFrame) throw Error(`Trim duration mismatch: ${relative}`);
  let retainedWaveError = 0;
  for (let frame = 0; frame < a.mono.length; frame++) retainedWaveError = Math.max(retainedWaveError, Math.abs(a.mono[frame] - originalAudio.mono[frame + onset.trimFrame]));
  if (retainedWaveError > 0.000002) throw Error(`Retained waveform changed: ${relative}`);
  trimAnalysis.push({ source: relative, file, sourceSha256: digest(fs.readFileSync(source)), productionSha256: digest(bytes), trimFrames: onset.trimFrame, trimMs: onset.trimSeconds * 1000, prerollMs: onset.onsetOffset * 1000, sourceDuration: originalAudio.duration, duration: a.duration, retainedWaveMaxError: retainedWaveError, naturalTailPreserved: true });
  voices.push({ id, file, title: path.basename(relative, '.mp4'), pools: ['mixed'], duration: a.duration, gain: a.gain, peak: a.peak, activeRms: a.loudness, envelopeStep: 0.02, envelope: a.envelope, original: relative, sourceDirectory: 'assets/source/voice', sourceSha256: digest(fs.readFileSync(source)), sha256: digest(bytes), processing: 'FFmpeg leading silence trim, retain 6 ms onset preroll and natural tail; FLAC 24-bit, no extra lossy encoding', sourceDuration: originalAudio.duration, trimSeconds: onset.trimSeconds, onsetOffset: onset.onsetOffset, onsetThreshold: onset.weakThreshold });
}
const catalog = {
  version: 1, date: new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()), title: '灰泽满 · 雨雾节拍',
  background: { kind: 'procedural', theme: '#111e2a', description: 'ink navy, graphite, steel blue and muted jade, fine rain texture and restrained metallic light; no background bitmap' },
  characters, pools: [{ id: 'mixed', label: '已选语音' }],
  music: { file: 'music.m4a', source: 'assets/source/music/背景音乐（缩减版）.wav', sourceSha256: musicSourceSha, barPhase: 1, sourceBytes: fs.statSync(musicSource).size, duration: music.duration, bpm: tempo.bpm, beatOffset: tempo.beatOffset, loopStart, loopEnd, gain: musicSourceGain(music.loudness, music.peak), peak: music.peak, activeRms: music.loudness, encoding: 'AAC 256 kbps stereo; lossy derivative, supplied WAV files retained', tempoAnalysis: tempo },
  voices,
  defaults: { version: 1, skin: 'uniform', pool: 'mixed', musicVolume: 0.50, voiceVolume: 0.9, masterVolume: 0.9, reduceMotion: false, bpm: tempo.bpm, beatOffset: tempo.beatOffset, barPhase: 1, musicId: musicIdentity },
  preparation: { ffmpeg: execFileSync(ffmpeg, ['-version'], { windowsHide: true, encoding: 'utf8' }).split('\n')[0], sharp: sharp.versions, humanListening: false },
};
const files = [...characters.frames.map(f => f.file), catalog.music.file, ...voices.map(v => v.file)];
catalog.resources = [...new Set(files)].map(file => ({ file, bytes: fs.statSync(path.join(out, file)).size, sha256: digest(fs.readFileSync(path.join(out, file))) }));
fs.writeFileSync(path.join(root, 'assets/catalog.json'), JSON.stringify(catalog, null, 2));
fs.writeFileSync(path.join(root, 'assets/analysis/voice-trim-analysis.json'), JSON.stringify({ date: new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()), method: '3 ms RMS, two-window hysteresis, bounded 35 ms quiet-onset backtrack, 6 ms preroll; FFmpeg resample then sample-exact atrim; stereo 24-bit FLAC', originalsPreserved: true, humanListening: false, voices: trimAnalysis }, null, 2));
console.log(JSON.stringify({ frames: characters.frames.length, voices: voices.length, bpm: tempo.bpm, beatOffset: tempo.beatOffset, tempoCandidates: tempo.candidates, musicDuration: music.duration, resourceBytes: catalog.resources.reduce((s, r) => s + r.bytes, 0) }, null, 2));
