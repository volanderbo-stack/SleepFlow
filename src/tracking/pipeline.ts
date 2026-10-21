import { EPOCH_MS, type Epoch } from '../db/types';
import { bandRatiosFromPower, DB_OFFSET, type AudioFrame } from './audioFeatures';
import { EpochAggregator } from './epochs';
import { powerSpectrum } from './fft';
import { SnoreDetector } from './snore';

/**
 * Протокол між основним потоком і AudioWorklet.
 * Увесь аналіз живе в аудіопотоці: він не «заморожується», коли вимкнено екран,
 * а повідомлення, що прийшли, поки сторінка спала, просто чекають у черзі.
 */
export type ToWorklet =
  | { type: 'start'; startedAt: number }
  | { type: 'motion'; samples: [number, number][] }
  | { type: 'alarm'; at: number | null }
  | { type: 'stop'; at: number };

export type FromWorklet =
  | { type: 'frame'; frame: AudioFrame; snoring: boolean; talking: boolean; baseline: number; calibrating: boolean }
  | { type: 'snoreStart'; t: number }
  | { type: 'epochs'; epochs: Epoch[] }
  | { type: 'deadline'; t: number }
  | { type: 'stopped'; epochs: Epoch[] };

export const FRAME_MS = 100;
const FFT_N = 4096;

/** Ріже потік семплів на кадри по 100 мс: рівень (RMS) + частки спектра за останні FFT_N семплів. */
export class FrameBuilder {
  private readonly frameLen: number;
  private readonly binHz: number;
  private ring = new Float32Array(FFT_N);
  private ordered = new Float32Array(FFT_N);
  private write = 0;
  private sumSq = 0;
  private count = 0;

  constructor(sampleRate: number) {
    this.frameLen = Math.round((sampleRate * FRAME_MS) / 1000);
    this.binHz = sampleRate / FFT_N;
  }

  /** Повертає кадри, що завершились у цьому блоці. Кадри цифрової тиші (мікрофон вимкнено) не повертаються. */
  push(samples: Float32Array, now: number): AudioFrame[] {
    const out: AudioFrame[] = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      this.ring[this.write] = s;
      this.write = (this.write + 1) % FFT_N;
      this.sumSq += s * s;
      if (++this.count >= this.frameLen) {
        const f = this.frame(now);
        if (f) out.push(f);
        this.sumSq = 0;
        this.count = 0;
      }
    }
    return out;
  }

  private frame(now: number): AudioFrame | null {
    if (this.sumSq === 0) return null;
    const rms = Math.sqrt(this.sumSq / this.count);
    const db = Math.max(0, 20 * Math.log10(rms + 1e-12) + DB_OFFSET);
    this.ordered.set(this.ring.subarray(this.write), 0);
    this.ordered.set(this.ring.subarray(0, this.write), FFT_N - this.write);
    return { t: now, db, ...bandRatiosFromPower(powerSpectrum(this.ordered), this.binHz) };
  }
}

/** Повний нічний конвеєр без браузерних API — його ганяє AudioWorklet, а тести — напряму. */
export class TrackingPipeline {
  private builder: FrameBuilder;
  private detector = new SnoreDetector();
  private agg: EpochAggregator | null = null;
  private alarmAt: number | null = null;

  constructor(sampleRate: number) {
    this.builder = new FrameBuilder(sampleRate);
  }

  handle(m: ToWorklet): FromWorklet[] {
    switch (m.type) {
      case 'start':
        this.agg = new EpochAggregator(m.startedAt);
        this.detector = new SnoreDetector();
        return [];
      case 'motion':
        for (const [t, d] of m.samples) this.agg?.addMotion(t, d);
        return [];
      case 'alarm':
        this.alarmAt = m.at;
        return [];
      case 'stop': {
        const epochs = this.agg ? this.agg.flush(m.at + EPOCH_MS) : [];
        this.agg = null;
        this.alarmAt = null;
        return [{ type: 'stopped', epochs }];
      }
    }
  }

  process(samples: Float32Array, now: number): FromWorklet[] {
    const out: FromWorklet[] = [];
    if (this.alarmAt !== null && now >= this.alarmAt) {
      out.push({ type: 'deadline', t: now });
      this.alarmAt = null;
    }
    const agg = this.agg;
    if (!agg) return out;
    for (const f of this.builder.push(samples, now)) {
      this.detector.baseline = agg.baseline;
      const st = this.detector.feed(f);
      agg.addAudio(f, st.snoring, st.talking);
      out.push({ type: 'frame', frame: f, snoring: st.snoring, talking: st.talking, baseline: agg.baseline, calibrating: agg.calibrating });
      if (st.episodeStarted) out.push({ type: 'snoreStart', t: f.t });
      const epochs = agg.flush(f.t);
      if (epochs.length) out.push({ type: 'epochs', epochs });
    }
    return out;
  }
}
