import { barPosition, mod } from './beat-clock.mjs';
const hash = n => { const value = Math.sin(n * 127.1 + 19.7) * 43758.5453; return value - Math.floor(value); };

// Sparse flights use the audio clock and a visual-only seed; they never draw from the voice RNG.
export function rhythmField(beat, width, height, phase = 0, consumed = new Set(), seed = 0) {
  const musical = barPosition(beat, phase), cycle = Math.floor(musical / 12), mobile = width < 600;
  const diagonal = Math.hypot(width, height), flights = [];
  for (let section = cycle - 1; section <= cycle + 1; section++) {
    for (let index = 0; index < 3; index++) {
      const random = value => hash(section * 43 + index * 17 + value * 11 + seed);
      if (index === 2 && (mobile || random(8) < 0.72)) continue;
      const target = section * 12 + (index === 0 ? 2.5 : 8.5) + Math.round(random(1) * 3) * 0.5 + (index === 2 ? 0.5 : 0);
      const slot = Math.round((target - phase) * 2), id = section + ':' + index;
      const delta = musical - target, lead = 2.0 + random(3) * 0.5, tail = 1.0 + random(4) * 0.35;
      if (slot < 0 || delta < -lead || delta > tail || consumed.has(id)) continue;
      const angle = random(2) * Math.PI * 2, speed = diagonal * (0.28 + random(6) * 0.07);
      const centerX = width * (0.2 + random(5) * 0.6), centerY = height * (0.2 + random(7) * 0.6);
      const x = centerX + Math.cos(angle) * delta * speed, y = centerY + Math.sin(angle) * delta * speed;
      const length = (mobile ? width * 0.43 : width * 0.24) * (1 + random(9) * 0.7);
      const alpha = Math.min(1, (delta + lead) / 0.45, (tail - delta) / 0.5);
      flights.push({ id, slot, targetBeat: slot / 2, x, y, angle, span: length, notes: [{ slot, type: 'streak', x: 0, y: 0, alpha, width: length, color: mod(section * 3 + index, 5) }] });
    }
  }
  return flights;
}
