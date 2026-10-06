// Hysteresis preserves quiet consonants while rejecting a short noise-only lead-in.
export function findVoiceOnset(samples, rate = 44100) {
  const frame = Math.max(1, Math.round(rate * 0.003)), energy = [];
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  for (let start = 0; start < samples.length; start += frame) {
    let sum = 0, end = Math.min(samples.length, start + frame);
    for (let i = start; i < end; i++) sum += samples[i] ** 2;
    energy.push(Math.sqrt(sum / (end - start)));
  }
  const head = energy.slice(0, 3).sort((a, b) => a - b), noise = head[Math.floor(head.length / 2)] || 0;
  const threshold = Math.max(0.0005, peak * 0.004, noise < peak * 0.01 ? noise * 3 : 0);
  let index = energy.findIndex((value, i) => value >= threshold && (energy[i + 1] ?? 0) >= threshold);
  if (index < 0) throw Error('Voice has no stable audible onset');
  const weakThreshold = Math.max(0.00025, threshold * 0.5), lookback = Math.ceil(0.035 * rate / frame);
  for (let count = 0; index > 0 && count < lookback && energy[index - 1] >= weakThreshold; count++) index--;
  const onsetFrame = Math.min(samples.length - 1, index * frame);
  const trimFrame = Math.max(0, onsetFrame - Math.round(rate * 0.006));
  return { trimFrame, onsetFrame, trimSeconds: trimFrame / rate, onsetOffset: (onsetFrame - trimFrame) / rate, threshold, weakThreshold, peak };
}
