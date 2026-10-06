export const MIX = Object.freeze({ musicRms: 0.20, musicPeak: 0.92, duckDb: -2.5, ceiling: 0.95 });

export function musicSourceGain(activeRms, peak) {
  return Math.min(MIX.musicRms / Math.max(activeRms, 0.001), MIX.musicPeak / Math.max(peak, 0.001));
}

export function outputCurve() {
  const curve = new Float32Array(16385);
  for (let i = 0; i < curve.length; i++) {
    const value = i * 2 / (curve.length - 1) - 1, magnitude = Math.abs(value);
    const result = magnitude <= 0.8 ? magnitude : 0.8 + 0.15 * (1 - (1 - (magnitude - 0.8) / 0.2) ** (4 / 3));
    curve[i] = Math.sign(value) * result;
  }
  return curve;
}

export function createOutputChain(context, destination) {
  const master = context.createGain(), compressor = context.createDynamicsCompressor(), ceiling = context.createWaveShaper();
  compressor.threshold.value = -8; compressor.knee.value = 8;
  compressor.ratio.value = 3; compressor.attack.value = 0.003; compressor.release.value = 0.20;
  ceiling.curve = outputCurve(); ceiling.oversample = '2x';
  master.connect(compressor); compressor.connect(ceiling); ceiling.connect(destination);
  return { master, compressor, ceiling };
}
