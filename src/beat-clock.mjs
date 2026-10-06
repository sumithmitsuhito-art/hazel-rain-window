export const mod = (value, count) => ((value % count) + count) % count;
// Grid phase and bar phase are distinct: a detected attack can be beat three.
export function beatInBar(position, phase = 0) { return mod(Math.floor(position + 1e-8) + phase, 4); }
export function barPosition(position, phase = 0) { return position + phase; }
