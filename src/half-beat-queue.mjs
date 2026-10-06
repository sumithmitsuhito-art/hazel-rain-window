export function nextHalfBeat(now, origin, bpm, guard = 0.025) {
  const step = 30 / bpm;
  const slot = Math.ceil((now + guard - origin) / step - 1e-9);
  return { slot, when: origin + slot * step, step };
}

export class HalfBeatQueue {
  constructor() { this.pending = new Map(); }
  push(event, now, origin, bpm) {
    const target = nextHalfBeat(now, origin, bpm);
    const entry = { ...event, ...target };
    this.pending.set(target.slot, entry);
    return entry;
  }
  take(now, horizon = 0.025) {
    const ready = [];
    for (const [slot, entry] of this.pending) {
      if (entry.when <= now + horizon) {
        this.pending.delete(slot);
        if (entry.when >= now - 0.03) ready.push(entry);
      }
    }
    return ready.sort((a, b) => a.when - b.when);
  }
  clear() { this.pending.clear(); }
  cancel(inputId) { for (const [slot, entry] of this.pending) if (entry.inputId === inputId) this.pending.delete(slot); }
  get size() { return this.pending.size; }
}
