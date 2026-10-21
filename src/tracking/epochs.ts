import { median } from '../analysis/time';
import { EPOCH_MS, type Epoch } from '../db/types';
import type { AudioFrame } from './audioFeatures';

export const CALIBRATION_MS = 2 * 60_000;
/** Звук гучніший за фон на стільки дБ вважається подією (шурхіт, рух). */
const SOUND_EVENT_DB = 10;
const SNORE_LIKE_LOW_RATIO = 0.65;
/** Хропіння в епосі має тривати хоча б стільки, щоб позначити епоху. */
const SNORE_EPOCH_MS = 5_000;
/** Мінімальний поріг шуму акселерометра, м/с². */
const MIN_ACCEL_THRESHOLD = 0.02;
/** Масштаб насичення: сума «надлишкових» змін прискорення за епоху, яка дає ~63% активності. */
const ACCEL_SCALE = 1.5;

interface Bucket {
  start: number;
  powerSum: number;
  frames: number;
  eventFrames: number;
  snoreMs: number;
  talk: boolean;
  accelDeltas: number[];
}

/**
 * Збирає аудіокадри та зміни прискорення в 30-секундні епохи.
 * Перші CALIBRATION_MS визначають фоновий шум і поріг шуму акселерометра.
 * Епохи без жодного аудіокадру (застосунок було згорнуто) не створюються — це розриви.
 */
export class EpochAggregator {
  readonly startedAt: number;
  private readonly epochMs: number;
  private calibDb: number[] = [];
  private calibAccel: number[] = [];
  private _baseline: number | null = null;
  private accelThreshold: number | null = null;
  private hasAccel = false;
  private bucket: Bucket | null = null;
  private ready: Epoch[] = [];
  private frameMs = 100;
  private lastFrameT = 0;

  constructor(startedAt: number, epochMs = EPOCH_MS) {
    this.startedAt = startedAt;
    this.epochMs = epochMs;
  }

  /** Фоновий рівень шуму, дБ (до кінця калібрування — медіана наявних кадрів). */
  get baseline(): number {
    return this._baseline ?? median(this.calibDb) ?? 35;
  }

  get calibrating(): boolean {
    return this._baseline === null;
  }

  get motionAvailable(): boolean {
    return this.hasAccel;
  }

  addAudio(f: AudioFrame, snoring: boolean, talking: boolean) {
    if (this.lastFrameT) this.frameMs = Math.min(1000, Math.max(20, f.t - this.lastFrameT));
    this.lastFrameT = f.t;

    if (f.t - this.startedAt < CALIBRATION_MS) this.calibDb.push(f.db);
    else if (this._baseline === null) this.finishCalibration();

    const b = this.bucketFor(f.t);
    b.powerSum += Math.pow(10, f.db / 10);
    b.frames++;
    // Низькочастотні звуки (схожі на хропіння ще до впевненого детектування) — не рух.
    if (!snoring && f.lowRatio <= SNORE_LIKE_LOW_RATIO && f.db > this.baseline + SOUND_EVENT_DB) b.eventFrames++;
    if (snoring) b.snoreMs += this.frameMs;
    if (talking) b.talk = true;
  }

  /** |Δприскорення| між двома послідовними подіями devicemotion, м/с². */
  addMotion(t: number, delta: number) {
    this.hasAccel = true;
    if (t - this.startedAt < CALIBRATION_MS) this.calibAccel.push(delta);
    this.bucketFor(t).accelDeltas.push(delta);
  }

  /** Повертає всі епохи, що закінчились до моменту now. */
  flush(now: number): Epoch[] {
    if (this.bucket && now >= this.bucket.start + this.epochMs) {
      this.close(this.bucket);
      this.bucket = null;
    }
    const out = this.ready;
    this.ready = [];
    return out;
  }

  private close(b: Bucket) {
    if (b.frames > 0) this.ready.push(this.toEpoch(b));
  }

  private finishCalibration() {
    this._baseline = median(this.calibDb) ?? 35;
    const m = median(this.calibAccel);
    this.accelThreshold = Math.max(MIN_ACCEL_THRESHOLD, (m ?? 0) * 4);
  }

  private bucketFor(t: number): Bucket {
    const start = this.startedAt + Math.floor((t - this.startedAt) / this.epochMs) * this.epochMs;
    if (!this.bucket || this.bucket.start !== start) {
      if (this.bucket) this.close(this.bucket);
      this.bucket = { start, powerSum: 0, frames: 0, eventFrames: 0, snoreMs: 0, talk: false, accelDeltas: [] };
    }
    return this.bucket;
  }

  private toEpoch(b: Bucket): Epoch {
    const noiseDb = 10 * Math.log10(b.powerSum / b.frames);
    const soundScore = Math.min(1, (b.eventFrames / b.frames) * 3);

    let motion = soundScore;
    if (this.hasAccel) {
      const thr = this.accelThreshold ?? Math.max(MIN_ACCEL_THRESHOLD, (median(this.calibAccel) ?? 0) * 4);
      const raw = b.accelDeltas.reduce((s, d) => s + Math.max(0, d - thr), 0);
      const accelScore = 1 - Math.exp(-raw / ACCEL_SCALE);
      motion = Math.max(accelScore, soundScore * 0.6);
    }

    return {
      t: b.start,
      noiseDb: Math.round(noiseDb * 10) / 10,
      motion: Math.round(motion * 1000) / 1000,
      snore: b.snoreMs >= SNORE_EPOCH_MS,
      talk: b.talk,
    };
  }
}
