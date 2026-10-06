import { rhythmField } from './rhythm-field.mjs';
import { barPosition, beatInBar, mod } from './beat-clock.mjs';
const hash = n => { const x = Math.sin(n * 127.1 + 19.7) * 43758.5453; return x - Math.floor(x); };
const TAU = Math.PI * 2;
const phaseOf = value => ((value % 1) + 1) % 1;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const COLORS = ['119,215,213', '140,192,237', '178,163,240', '225,147,190', '239,194,143'];
const rgba = (color, alpha) => `rgba(${color},${clamp(alpha, 0, 1)})`;

export class VisualScene {
  constructor(canvas, catalog) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.catalog = catalog;
    this.images = new Map(); this.effects = []; this.tapSerial = 0; this.currentFrame = 'idle'; this.hitSlots = new Map(); this.lanes = [];
    this.flightHits = new Map(); this.fieldSeed = crypto.getRandomValues(new Uint32Array(1))[0] % 100000;
    const texture = document.createElement('canvas'); texture.width = texture.height = 96;
    const paint = texture.getContext('2d'), grain = paint.createImageData(96, 96);
    for (let i = 0; i < 96 * 96; i++) { const value = Math.round(60 + hash(i + 977) * 150); grain.data.set([value, value, value, 255], i * 4); }
    paint.putImageData(grain, 0, 0); this.grain = this.ctx.createPattern(texture, 'repeat');
    this.noteSprites = COLORS.map(color => {
      const tile = document.createElement('canvas'); tile.width = 128; tile.height = 48;
      const p = tile.getContext('2d'); p.shadowColor = rgba(color, 0.9); p.shadowBlur = 12;
      p.fillStyle = rgba(color, 0.9); p.fillRect(24, 21, 80, 6); p.shadowBlur = 0;
      p.fillStyle = 'rgba(230,247,255,0.95)'; p.fillRect(26, 23, 76, 2); return tile;
    });
    this.bounds = null; this.scale = 1; this.beatPulse = 0; this.haloFlash = 0; this.resize();
  }
  resize() {
    this.width = window.innerWidth; this.height = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.canvas.width = Math.round(this.width * this.dpr); this.canvas.height = Math.round(this.height * this.dpr);
  }
  setImages(images) { this.images = images; }
  confirm(when, point) {
    const x = Number.isFinite(point?.x) ? point.x : this.width / 2;
    const y = Number.isFinite(point?.y) ? point.y : this.height / 2;
    const effect = { when, clock: 'ambient', kind: 'tap', life: 1.25, x: clamp(x / this.width, 0, 1), y: clamp(y / this.height, 0, 1), variant: this.tapSerial++ % 5 };
    this.lastTap = effect; this.addEffect(effect);
  }
  trigger(when, point, slot, id) {
    this.addEffect({ when, clock: 'audio', kind: 'voice', life: 0.95, slot, id, x: (point?.x ?? this.width / 2) / this.width, y: (point?.y ?? this.height / 2) / this.height });
    if (Number.isFinite(slot)) this.hitSlots.set(slot, when);
    while (this.hitSlots.size > 24) this.hitSlots.delete(this.hitSlots.keys().next().value);
    if (Number.isFinite(slot)) {
      const flights = rhythmField(slot / 2, this.width, this.height, this.barPhase ?? this.catalog.defaults.barPhase, new Set(this.flightHits.keys()), this.fieldSeed);
      const px = point?.x ?? this.width / 2, py = point?.y ?? this.height / 2;
      flights.sort((a, b) => Math.hypot(a.x-px,a.y-py)-Math.hypot(b.x-px,b.y-py));
      if (flights[0]) this.flightHits.set(flights[0].id, { when, voiceId: id, flight: flights[0] });
      while (this.flightHits.size > 24) this.flightHits.delete(this.flightHits.keys().next().value);
    }
  }
  cancelTrigger(voice) {
    this.effects = this.effects.filter(effect => effect.id !== voice.id);
    if (this.hitSlots.get(voice.slot) === voice.start) this.hitSlots.delete(voice.slot);
    for (const [id, hit] of this.flightHits) if (hit.voiceId === voice.id) this.flightHits.delete(id);
  }
  addEffect(effect) { this.effects.push(effect); if (this.effects.length > 16) this.effects.shift(); }
  clearFeedback() { this.effects.length = 0; this.lastTap = null; this.hitSlots.clear(); this.flightHits.clear(); }
  render({ time, ambientTime, beatPosition, settings, voices, running }) {
    const { ctx, width: w, height: h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const playing = running && Number.isFinite(beatPosition) && beatPosition >= 0;
    const beat = playing ? beatPosition : 0;
    const musicalBeat = barPosition(beat, settings.barPhase || 0);
    this.barBeat = playing ? beatInBar(beat, settings.barPhase || 0) : -1;
    this.barPhase = settings.barPhase || 0;
    const pulse = playing ? ((1 + Math.cos(phaseOf(beat) * TAU)) / 2) ** 1.7 : 0;
    const nowOf = effect => effect.clock === 'audio' ? time : ambientTime;
    this.effects = this.effects.filter(effect => nowOf(effect) - effect.when < effect.life);
    let flash = 0, tapResponse = 0;
    for (const effect of this.effects) {
      const age = nowOf(effect) - effect.when;
      if (age < 0) continue;
      if (effect.kind === 'tap') {
        flash += Math.exp(-age * 4.5) * (0.72 + 0.28 * Math.cos(age * 20) ** 2);
        if (age < 0.30) tapResponse = Math.max(tapResponse, Math.sin(age / 0.30 * Math.PI));
      } else flash += Math.exp(-age * 6) * 0.35;
    }
    this.haloFlash = Math.min(1.2, flash);
    this.beatPulse = settings.reduceMotion ? 0 : pulse;
    this.drawAtmosphere(settings.reduceMotion ? 0 : ambientTime, settings.reduceMotion ? 0 : this.haloFlash);
    this.drawRhythm(musicalBeat, settings.reduceMotion ? 0 : pulse, settings.reduceMotion ? 0 : this.haloFlash, playing, settings.reduceMotion);
    this.lanes = playing && !settings.reduceMotion ? rhythmField(beat, w, h, settings.barPhase || 0, new Set([...this.flightHits].filter(([, hit]) => hit.when <= time).map(([id]) => id)), this.fieldSeed) : [];
    this.drawNoteField(time, beat, this.haloFlash, settings.reduceMotion);
    this.drawFieldFeedback(time, ambientTime, settings.reduceMotion);

    const frame = this.catalog.characters.frames[0], image = this.images.get(frame?.file);
    if (!frame || !image) return;
    const aspect = frame.width / frame.height, figureHeight = Math.min(h * 0.58, 560, w * 0.78 / aspect);
    const idle = playing ? 0 : (1 + Math.sin(ambientTime * TAU / 6)) * 0.0007;
    this.scale = settings.reduceMotion ? 1 : 1 + pulse * 0.0045 + idle + tapResponse * 0.014;
    const height = figureHeight * this.scale, width = height * aspect, x = w / 2 - width / 2, y = h / 2 - height / 2;
    ctx.save(); ctx.shadowColor = 'rgba(0,8,14,0.45)'; ctx.shadowBlur = 22;
    ctx.drawImage(image, x, y, width, height); ctx.restore();
    this.bounds = { x, y, width, height }; this.currentFrame = 'idle';
    // Cursor effects sit above the still image so taps on the character remain visible.
    this.drawCursorFeedback(ambientTime, settings.reduceMotion);
    let voice = null;
    for (const candidate of voices) if (candidate.start <= time && candidate.end > time && (!voice || candidate.start > voice.start)) voice = candidate;
    this.latestCaption = voice?.sample.title ?? null;
  }
  glow(x, y, radius, color, alpha) {
    const ctx = this.ctx, gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, rgba(color, alpha)); gradient.addColorStop(0.45, rgba(color, alpha * 0.34)); gradient.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  drawAtmosphere(time, energy) {
    const { ctx, width: w, height: h } = this;
    ctx.fillStyle = this.catalog.background.theme; ctx.fillRect(0, 0, w, h);
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, 'rgba(23,39,53,0.45)'); gradient.addColorStop(0.5, 'rgba(62,84,99,0.07)'); gradient.addColorStop(1, 'rgba(6,14,22,0.35)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    this.glow(w * 0.26 + Math.sin(time * 0.07) * 18, h * 0.42, Math.max(w, h) * 0.63, '67,112,115', 0.13 + energy * 0.05);
    this.glow(w * 0.83, h * 0.62, Math.max(w, h) * 0.54, '55,83,107', 0.12 + energy * 0.05);
    this.glow(w / 2, h * 0.47, Math.min(w, h) * 0.53, '135,164,180', 0.08);
    for (let i = 0; i < 3; i++) {
      const y = h * (0.16 + i * 0.31) + Math.sin(time * 0.11 + i) * 12;
      const band = ctx.createLinearGradient(0, y - 90, 0, y + 90);
      band.addColorStop(0, 'rgba(136,157,169,0)'); band.addColorStop(0.5, 'rgba(136,157,169,0.028)'); band.addColorStop(1, 'rgba(136,157,169,0)');
      ctx.fillStyle = band; ctx.fillRect(0, y - 90, w, 180);
    }
    ctx.save(); ctx.globalAlpha = 0.018; ctx.fillStyle = this.grain; ctx.fillRect(0, 0, w, h); ctx.restore();
    ctx.save(); ctx.lineCap = 'round';
    for (let i = 0; i < (w < 600 ? 30 : 58); i++) {
      const x = hash(i + 2) * w, y = ((hash(i + 84) + time * (0.018 + hash(i + 10) * 0.012)) % 1) * (h + 80) - 40;
      const length = 15 + hash(i + 27) * 43;
      ctx.strokeStyle = rgba(COLORS[i % COLORS.length], 0.045 + hash(i + 51) * 0.085 + energy * 0.04); ctx.lineWidth = 0.5 + hash(i + 32) * 0.7;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y + length); ctx.stroke();
    }
    // Sparse luminous dust keeps the matte rain palette from becoming flat.
    for (let i = 0; i < 20; i++) {
      const x = (hash(i + 213) + Math.sin(time * 0.10 + i) * 0.007) * w, y = (hash(i + 333) + Math.cos(time * 0.08 + i) * 0.008) * h;
      ctx.fillStyle = rgba(COLORS[i % COLORS.length], 0.10 + hash(i + 77) * 0.10 + energy * 0.09);
      ctx.beginPath(); ctx.arc(x, y, 0.7 + hash(i + 187) * 0.8, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  glyph(pattern, size) {
    const ctx = this.ctx;
    ctx.beginPath();
    if (pattern === 0) for (let i = 0; i < 3; i++) { const y = (i - 1) * size * 0.5; ctx.moveTo(-size * (1 - i * 0.15), y); ctx.lineTo(size * (1 - i * 0.15), y); }
    else if (pattern === 1) { ctx.moveTo(0, -size); ctx.lineTo(size * 0.7, 0); ctx.lineTo(0, size); ctx.lineTo(-size * 0.7, 0); ctx.closePath(); }
    else if (pattern === 2) { ctx.arc(0, 0, size * 0.8, -0.5, Math.PI * 1.3); ctx.moveTo(-size * 1.35, 0); ctx.lineTo(-size * 0.5, 0); }
    else if (pattern === 3) { ctx.moveTo(-size, -size); ctx.lineTo(-size, size); ctx.lineTo(size, size); ctx.moveTo(size, -size * 0.3); ctx.lineTo(size, -size); ctx.lineTo(size * 0.3, -size); }
    else if (pattern === 4) for (let i = 0; i <= 6; i++) { const a = i * TAU / 6; i ? ctx.lineTo(Math.cos(a) * size, Math.sin(a) * size) : ctx.moveTo(Math.cos(a) * size, Math.sin(a) * size); }
    else { ctx.moveTo(-size, 0); ctx.lineTo(size, 0); ctx.moveTo(0, -size); ctx.lineTo(0, size); ctx.moveTo(-size * 0.35, -size * 0.35); ctx.lineTo(size * 0.35, size * 0.35); }
    ctx.stroke();
  }
  drawRhythm(beat, pulse, energy, running, reduced) {
    const { ctx, width: w, height: h } = this;
    const x = w / 2, y = h / 2, unit = Math.min(w * 0.43, h * 0.30);
    const phase = running ? phaseOf(beat) : 0, half = running ? phaseOf(beat * 2) : 0;
    ctx.save();
    this.glow(x, y, unit * 1.3, COLORS[0], 0.13 + pulse * 0.055 + energy * 0.29);
    this.glow(x, y, unit * 0.93, COLORS[1], energy * 0.14);
    ctx.lineWidth = 1;
    for (let ring = 0; ring < 3; ring++) {
      const radius = unit * (0.87 + ring * 0.15) * (1 + pulse * 0.012 + energy * 0.018);
      const angle = reduced ? ring * 0.7 : beat * (ring % 2 ? -0.045 : 0.04) + ring * 0.7;
      ctx.strokeStyle = rgba(COLORS[ring], 0.14 + pulse * 0.10 + energy * 0.36);
      ctx.lineWidth = ring ? 0.8 : 1.3;
      ctx.beginPath(); ctx.arc(x, y, radius, angle + 0.12, angle + 2.7); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, radius, angle + Math.PI + 0.12, angle + Math.PI + 2.7); ctx.stroke();
    }
    for (let i = 0; i < 64; i++) {
      const a = i * TAU / 64 + (reduced ? 0 : beat * 0.011), radius = unit * 1.13, major = i % 8 === 0;
      const length = major ? 10 + pulse * 6 + energy * 10 : 2.5 + energy * 3;
      ctx.strokeStyle = rgba(COLORS[i % COLORS.length], (major ? 0.28 : 0.13) + pulse * 0.10 + energy * 0.22);
      ctx.lineWidth = major ? 1.2 : 0.8;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
      ctx.lineTo(x + Math.cos(a) * (radius + length), y + Math.sin(a) * (radius + length)); ctx.stroke();
    }
    if (running && !reduced) for (let i = 0; i < 3; i++) {
      const age = half + i, radius = unit * (0.72 + age * 0.18);
      ctx.strokeStyle = rgba(COLORS[i], 0.30 * (1 - age / 3) ** 2 + energy * 0.12); ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(x, y, radius, -0.6 + beat * 0.035, 2.6 + beat * 0.035); ctx.stroke();
    }
    // Flowing side ribbons, accentuated on every beat and by the click impulse.
    for (let side = 0; side < 2; side++) for (let line = 0; line < 3; line++) {
      const left = side === 0, sx = left ? -w * 0.04 : w * 1.04, ex = left ? w * 0.39 : w * 0.61;
      const sy = h * (0.26 + line * 0.032 + side * 0.28), amplitude = (reduced ? 0 : Math.sin(beat * TAU / 4 + line) * 12) + energy * 20;
      ctx.strokeStyle = rgba(COLORS[(side + line) % COLORS.length], 0.12 + pulse * 0.12 + energy * 0.23); ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(left ? w * 0.18 : w * 0.82, sy - amplitude - 22, left ? w * 0.15 : w * 0.85, sy + h * 0.17, ex, sy + h * 0.14 + amplitude); ctx.stroke();
    }
    const pattern = running && !reduced ? ((Math.floor(beat / 4) % 6) + 6) % 6 : 0;
    const points = [[w * 0.16, h * 0.36], [w * 0.84, h * 0.64], [w * 0.23, h * 0.71], [w * 0.77, h * 0.29], [w * 0.11, h * 0.57], [w * 0.89, h * 0.43]];
    for (let i = 0; i < points.length; i++) {
      const [px, py] = points[i], travel = reduced ? 0 : Math.sin(beat * TAU / 8 + i) * 7;
      ctx.save(); ctx.translate(px, py + travel);
      ctx.rotate(reduced ? 0 : Math.sin(beat * TAU / 16 + i) * 0.12);
      ctx.strokeStyle = rgba(COLORS[i % COLORS.length], 0.29 + pulse * 0.22 + energy * 0.32); ctx.lineWidth = 1;
      this.glyph(pattern, (w < 600 ? 15 : 27) * (1 + pulse * 0.13 + energy * 0.19)); ctx.restore();
    }
    // Slow orbiting shards echo the geometry without moving the character.
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6 + (reduced ? 0 : beat * 0.06), radius = unit * (1.34 + 0.04 * Math.sin(i + (reduced ? 0 : beat * 0.2)));
      ctx.save(); ctx.translate(x + Math.cos(a) * radius, y + Math.sin(a) * radius * 0.84);
      ctx.rotate(a + Math.PI / 4); ctx.strokeStyle = rgba(COLORS[i % COLORS.length], 0.25 + pulse * 0.12 + energy * 0.25); ctx.lineWidth = 0.9;
      const size = 4 + pulse * 2 + energy * 2; ctx.strokeRect(-size, -size, size * 2, size * 2); ctx.restore();
    }
    const railY = h * 0.81, railWidth = Math.min(w * 0.55, 490);
    ctx.strokeStyle = rgba(COLORS[2], 0.24); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(x - railWidth / 2, railY); ctx.lineTo(x + railWidth / 2, railY); ctx.stroke();
    for (let i = 0; i < 31; i++) {
      const px = x + (i - 15) * railWidth / 30, amount = Math.exp(-(((i - 15) / 7) ** 2));
      const wave = reduced ? 0 : (0.5 + 0.5 * Math.sin(beat * TAU - i * 0.4)) * 0.4;
      const length = 3 + amount * (4 + pulse * 16 + wave * 15 + energy * 23);
      ctx.strokeStyle = rgba(COLORS[i % COLORS.length], 0.28 + amount * (pulse * 0.26 + energy * 0.3)); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(px, railY - length / 2); ctx.lineTo(px, railY + length / 2); ctx.stroke();
    }
    this.rhythmPattern = pattern; ctx.restore();
  }
  drawNoteField(time, beat, energy, reduced) {
    this.noteCount = 0; this.hitBursts = 0;
    if (reduced) return;
    const ctx = this.ctx;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (const flight of this.lanes) {
      const note = flight.notes[0], color = COLORS[note.color]; this.noteCount++;
      ctx.save(); ctx.translate(flight.x, flight.y); ctx.rotate(flight.angle);
      ctx.globalAlpha = note.alpha * (0.62 + energy * 0.12);
      const trail = ctx.createLinearGradient(-note.width, 0, 0, 0);
      trail.addColorStop(0, rgba(color, 0)); trail.addColorStop(1, rgba(color, 0.24));
      ctx.strokeStyle = trail; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(-note.width, 0); ctx.lineTo(0, 0); ctx.stroke();
      ctx.drawImage(this.noteSprites[note.color], -note.width * 0.8, -18, note.width * 1.6, 36);
      ctx.restore();
    }
    for (const hit of this.flightHits.values()) {
      const age = time - hit.when;
      if (age < 0 || age > 0.55) continue;
      this.hitBursts++;
      const flight = hit.flight, p = age / 0.55, fade = (1-p) ** 2;
      ctx.save(); ctx.translate(flight.x, flight.y); ctx.rotate(flight.angle);
      this.glow(0, 0, 60 + p * 60, COLORS[flight.notes[0].color], fade * 0.30);
      for (let piece = 0; piece < 12; piece++) {
        const x = (piece / 11 - 0.5) * flight.span + (hash(piece+8)-0.5) * p * 90;
        const y = (hash(piece+29)-0.5) * p * 130;
        ctx.save(); ctx.translate(x,y); ctx.rotate((hash(piece+3)-0.5)*p*2);
        ctx.fillStyle = rgba(COLORS[piece % COLORS.length],fade*0.85);
        ctx.fillRect(-6-fade*6,-0.8,12+fade*12,1.6); ctx.restore();
      }
      ctx.restore();
    }
    ctx.restore();
  }
  drawFieldFeedback(time, ambientTime, reduced) {
    const { ctx, width: w, height: h } = this;
    ctx.save();
    for (const effect of this.effects) {
      const age = (effect.clock === 'audio' ? time : ambientTime) - effect.when;
      if (age < 0 || age >= effect.life) continue;
      if (effect.kind === 'voice') {
        const p = age / effect.life, radius = Math.min(w * 0.38, h * 0.30) * (reduced ? 1 : 0.88 + p * 0.42);
        ctx.strokeStyle = rgba(COLORS[0], (1 - p) ** 2 * 0.36); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(w / 2, h / 2, radius, 0, TAU); ctx.stroke();
        if (!reduced) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          this.glow(effect.x * w, effect.y * h, 80 + p * 90, COLORS[2], (1 - p) ** 3 * 0.35);
          ctx.restore();
        }
        continue;
      }
      const p = age / effect.life, x = effect.x * w, y = effect.y * h, color = COLORS[effect.variant % COLORS.length];
      if (reduced) continue;
      const radius = 35 + (1 - (1 - p) ** 2) * Math.min(Math.max(w, h) * 0.72, 900);
      ctx.strokeStyle = rgba(color, (1 - p) ** 2 * 0.24); ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.stroke();
      this.glow(x, y, 170 + p * 120, color, (1 - p) ** 3 * 0.20);
      const travel = Math.min(1, age / 0.36), tx = x + (w / 2 - x) * travel, ty = y + (h / 2 - y) * travel;
      ctx.strokeStyle = rgba(color, (1 - p) ** 2 * 0.30);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo((x + tx) / 2, (y + ty) / 2 - 25, tx, ty); ctx.stroke();
      this.glow(tx, ty, 16, color, (1 - p) ** 2 * 0.34);
    }
    ctx.restore();
  }
  drawCursorFeedback(time, reduced) {
    const ctx = this.ctx;
    ctx.save(); ctx.lineCap = 'round'; ctx.globalCompositeOperation = 'lighter';
    for (const effect of this.effects) {
      if (effect.kind !== 'tap') continue;
      const age = time - effect.when, life = 0.85 + (effect.variant === 3 ? 0.15 : 0);
      if (age < 0 || age >= life) continue;
      const p = age / life, fade = (1 - p) ** 2, ease = 1 - (1 - p) ** 3;
      const x = effect.x * this.width, y = effect.y * this.height, color = COLORS[effect.variant % COLORS.length];
      ctx.save(); ctx.translate(x, y);
      this.glow(0, 0, reduced ? 32 : 75 + ease * 65, color, fade * 0.48);
      if (!reduced) {
        this.glow(0, 0, 18 + ease * 20, '210,237,247', fade * 0.48);
        const chroma = ctx.createLinearGradient(-100, -60, 100, 60);
        chroma.addColorStop(0, rgba(COLORS[0], fade)); chroma.addColorStop(0.5, rgba(COLORS[2], fade)); chroma.addColorStop(1, rgba(COLORS[3], fade));
        ctx.strokeStyle = chroma;
      } else ctx.strokeStyle = rgba(color, fade * 0.95);
      ctx.lineWidth = 2.3;
      if (reduced) { ctx.beginPath(); ctx.arc(0, 0, 18, 0, TAU); ctx.stroke(); ctx.restore(); continue; }
      const radius = 10 + ease * (effect.variant === 2 ? 110 : 82);
      if (effect.variant === 0) {
        ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.stroke();
        ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(0, 0, radius * 0.67, 0, TAU); ctx.stroke();
      } else if (effect.variant === 1) {
        ctx.rotate(p * 0.35); this.glyph(5, radius * 0.7);
        ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, radius, 0.2, Math.PI * 1.5); ctx.stroke();
      } else if (effect.variant === 2) {
        ctx.rotate(p * 0.32); this.glyph(4, radius * 0.8);
        ctx.lineWidth = 0.9; this.glyph(1, radius * 0.44);
      } else if (effect.variant === 3) {
        ctx.rotate(p * 1.3);
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, radius * (0.58 + i * 0.20), i * 1.4, i * 1.4 + Math.PI * 1.3); ctx.stroke(); }
      } else {
        for (let i = 0; i < 12; i++) {
          const a = i * TAU / 12, start = radius * 0.43, end = radius * (0.74 + hash(i + 44) * 0.35);
          ctx.beginPath(); ctx.moveTo(Math.cos(a) * start, Math.sin(a) * start); ctx.lineTo(Math.cos(a) * end, Math.sin(a) * end); ctx.stroke();
        }
      }
      const count = effect.variant === 4 ? 24 : 18;
      for (let i = 0; i < count; i++) {
        const a = i * TAU / count + effect.variant * 0.31, distance = 13 + ease * (65 + hash(i + effect.variant * 23) * 48);
        const px = Math.cos(a) * distance, py = Math.sin(a) * distance, length = 2 + (1 - p) * 8;
        ctx.strokeStyle = rgba(COLORS[(i + effect.variant) % COLORS.length], fade * 0.90); ctx.lineWidth = i % 3 ? 1 : 1.8;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - Math.cos(a) * length, py - Math.sin(a) * length); ctx.stroke();
        if (i % 3 === 0) { ctx.save(); ctx.translate(px, py); ctx.rotate(a + p); ctx.fillStyle = rgba(color, fade * 0.65); ctx.fillRect(-2, -2, 4, 4); ctx.restore(); }
      }
      ctx.restore();
    }
    ctx.restore();
  }
  stats() {
    return { frame: this.currentFrame, bounds: this.bounds, effectCount: this.effects.length, decodedImages: this.images.size, caption: this.latestCaption, scale: this.scale, beatPulse: this.beatPulse, haloFlash: this.haloFlash, rhythmPattern: this.rhythmPattern, barBeat: this.barBeat, noteCount: this.noteCount, hitBursts: this.hitBursts, lanes: this.lanes.map(l=>({id:l.id,slot:l.slot,x:l.x,y:l.y,angle:l.angle,span:l.span,notes:l.notes.map(n=>({slot:n.slot,y:n.y,type:n.type,width:n.width}))})), background: 'procedural', lastTap: this.lastTap ? { x: this.lastTap.x * this.width, y: this.lastTap.y * this.height, variant: this.lastTap.variant } : null };
  }
}
