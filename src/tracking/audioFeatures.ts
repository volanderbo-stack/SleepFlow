/** Ознаки одного аудіокадру (~100 мс). Сирий звук ніде не зберігається. */
export interface AudioFrame {
  t: number;
  /** Приблизний рівень, дБ (dBFS + 100; калібрується відносно фону ночі). */
  db: number;
  /** Частка енергії в діапазоні хропіння 100–1000 Гц. */
  lowRatio: number;
  /** Частка енергії в мовному діапазоні 300–3000 Гц. */
  speechRatio: number;
}

export const DB_OFFSET = 100;
const BAND_MIN = 80;
const BAND_MAX = 4000;

/** RMS часового сигналу → дБ. */
export function rmsDb(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return Math.max(0, 20 * Math.log10(rms + 1e-12) + DB_OFFSET);
}

/**
 * Частки енергії по діапазонах зі спектра AnalyserNode.getFloatFrequencyData (дБ на бін).
 * binHz = sampleRate / fftSize.
 */
export function bandRatios(spectrumDb: Float32Array, binHz: number): { lowRatio: number; speechRatio: number } {
  return ratios(spectrumDb.length, binHz, (i) => Math.pow(10, spectrumDb[i] / 10));
}

/** Те саме для спектра потужності (з fft.ts). */
export function bandRatiosFromPower(power: Float32Array, binHz: number): { lowRatio: number; speechRatio: number } {
  return ratios(power.length, binHz, (i) => power[i]);
}

function ratios(bins: number, binHz: number, powerAt: (i: number) => number): { lowRatio: number; speechRatio: number } {
  let total = 0;
  let low = 0;
  let speech = 0;
  for (let i = 0; i < bins; i++) {
    const f = i * binHz;
    if (f < BAND_MIN || f > BAND_MAX) continue;
    const p = powerAt(i);
    total += p;
    if (f >= 100 && f <= 1000) low += p;
    if (f >= 300 && f <= 3000) speech += p;
  }
  if (total <= 0) return { lowRatio: 0, speechRatio: 0 };
  return { lowRatio: low / total, speechRatio: speech / total };
}

export function computeFrame(t: number, timeData: Float32Array, spectrumDb: Float32Array, binHz: number): AudioFrame {
  return { t, db: rmsDb(timeData), ...bandRatios(spectrumDb, binHz) };
}
