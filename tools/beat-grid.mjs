const percentile = (values, p) => { const ordered = [...values].sort((a, b) => a - b); return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * p))] ?? 0; };

// Refine a spectral-flux estimate against nearby attacks across the complete track.
export function refineBeatGrid(onset, fps, centerOffset, initial) {
  let period = 60 / initial.bpm, offset = initial.beatOffset, attacks = [];
  const floor = percentile(onset.filter(v => v > 0), 0.55);
  const radius = Math.max(2, Math.ceil(fps * 0.065));
  for (let pass = 0; pass < 3; pass++) {
    attacks = [];
    for (let beat = 0; offset + beat * period < onset.length / fps; beat++) {
      const target = (offset + beat * period - centerOffset) * fps;
      const first = Math.max(1, Math.round(target) - radius), last = Math.min(onset.length - 2, Math.round(target) + radius);
      let peak = first;
      for (let i = first + 1; i <= last; i++) if (onset[i] > onset[peak]) peak = i;
      if (onset[peak] < floor || peak === first || peak === last) continue;
      const left = onset[peak - 1], value = onset[peak], right = onset[peak + 1];
      const denominator = left - 2 * value + right;
      const fraction = denominator ? Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / denominator)) : 0;
      const time = (peak + fraction) / fps + centerOffset;
      attacks.push({ beat, time, weight: Math.min(2, value / Math.max(floor, 1e-8)) });
    }
    if (attacks.length < 12) break;
    const residuals = attacks.map(a => a.time - offset - a.beat * period), median = percentile(residuals, 0.5);
    const mad = percentile(residuals.map(v => Math.abs(v - median)), 0.5);
    const accepted = attacks.filter((a, i) => Math.abs(residuals[i] - median) <= Math.max(0.016, mad * 3));
    let sum = 0, beatMean = 0, timeMean = 0;
    for (const a of accepted) { sum += a.weight; beatMean += a.beat * a.weight; timeMean += a.time * a.weight; }
    beatMean /= sum; timeMean /= sum;
    let numerator = 0, denominator = 0;
    for (const a of accepted) { numerator += a.weight * (a.beat - beatMean) * (a.time - timeMean); denominator += a.weight * (a.beat - beatMean) ** 2; }
    const fitted = numerator / denominator;
    if (!Number.isFinite(fitted) || Math.abs(fitted / (60 / initial.bpm) - 1) > 0.02) break;
    period = fitted; offset = timeMean - period * beatMean; attacks = accepted;
  }
  const bpm = Number((60 / period).toFixed(3)); period = 60 / bpm;
  offset = ((offset % period) + period) % period;
  const beatOffset = Number(offset.toFixed(5));
  const errors = attacks.map(a => Math.abs(a.time - (beatOffset + Math.round((a.time - beatOffset) / period) * period)) * 1000);
  const checkpoints = [0, 0.25, 0.5, 0.75].map((start, i) => {
    const end = (i + 1) / 4, rows = attacks.filter(a => a.time >= start * onset.length / fps && a.time < end * onset.length / fps);
    return { from: Number((start * onset.length / fps).toFixed(2)), to: Number((end * onset.length / fps).toFixed(2)), attacks: rows.length, medianErrorMs: Number(percentile(rows.map(a => Math.abs(a.time - (beatOffset + Math.round((a.time - beatOffset) / period) * period)) * 1000), 0.5).toFixed(3)) };
  });
  return { bpm, beatOffset, attackCount: attacks.length, medianErrorMs: Number(percentile(errors, 0.5).toFixed(3)), p95ErrorMs: Number(percentile(errors, 0.95).toFixed(3)), checkpoints, attacks: attacks.map(a => ({ beat: Math.round((a.time - beatOffset) / period), time: Number(a.time.toFixed(5)), errorMs: Number((a.time - (beatOffset + Math.round((a.time - beatOffset) / period) * period)).toFixed(6)) * 1000 })) };
}
