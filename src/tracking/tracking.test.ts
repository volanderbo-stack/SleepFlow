import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../db/demoData';
import type { Epoch } from '../db/types';
import type { AudioFrame } from './audioFeatures';
import { bandRatios, rmsDb } from './audioFeatures';
import { CALIBRATION_MS, EpochAggregator } from './epochs';
import { SnoreDetector } from './snore';

const T0 = 1_000_000;
const FRAME = 100;

/** Генерує кадри: тихий фон + сплески заданого спектра. */
function frames(durationMs: number, burstAt: (t: number) => Partial<AudioFrame> | null, seed = 1): AudioFrame[] {
  const rand = mulberry32(seed);
  const out: AudioFrame[] = [];
  for (let t = 0; t < durationMs; t += FRAME) {
    const burst = burstAt(t);
    out.push({ t: T0 + t, db: 32 + rand() * 2, lowRatio: 0.4, speechRatio: 0.4, ...(burst ?? {}) });
  }
  return out;
}

const snoreBurst = (period: number, len = 1000) => (t: number) => (t % period < len ? { db: 55, lowRatio: 0.85, speechRatio: 0.3 } : null);

describe('audioFeatures', () => {
  it('rmsDb: тиша ≈ 0, повна амплітуда ≈ 100', () => {
    expect(rmsDb(new Float32Array(256))).toBe(0);
    expect(rmsDb(new Float32Array(256).fill(1))).toBeCloseTo(100, 0);
  });

  it('bandRatios: енергія на 200 Гц — це діапазон хропіння', () => {
    const binHz = 48000 / 2048;
    const spec = new Float32Array(1024).fill(-120);
    spec[Math.round(200 / binHz)] = -20;
    const r = bandRatios(spec, binHz);
    expect(r.lowRatio).toBeGreaterThan(0.95);
    expect(r.speechRatio).toBeLessThan(0.05);
  });
});

describe('SnoreDetector', () => {
  it('ритмічні низькочастотні сплески кожні 3.5 с — хропіння', () => {
    const d = new SnoreDetector(33);
    let started = 0;
    let snoringAt60s = false;
    for (const f of frames(60_000, snoreBurst(3500))) {
      const s = d.feed(f);
      if (s.episodeStarted) started++;
      if (f.t - T0 >= 59_000) snoringAt60s ||= s.snoring;
    }
    expect(started).toBe(1);
    expect(snoringAt60s).toBe(true);
  });

  it('епізод завершується після 10 с тиші', () => {
    const d = new SnoreDetector(33);
    let ended: { from: number; to: number } | null = null;
    for (const f of frames(60_000, (t) => (t < 30_000 ? snoreBurst(3500)(t) : null))) ended = d.feed(f).episodeEnded ?? ended;
    expect(ended).not.toBeNull();
    expect(ended!.to - T0).toBeLessThan(31_000);
  });

  it('нерегулярні сплески — не хропіння', () => {
    const d = new SnoreDetector(33);
    const at = new Set([1000, 1500, 9000, 9400, 20000, 31000, 31500]);
    const fs = frames(40_000, (t) => ([...at].some((a) => t >= a && t < a + 500) ? { db: 55, lowRatio: 0.85 } : null));
    expect(fs.some((f) => d.feed(f).snoring)).toBe(false);
  });

  it('мовні сплески — розмова, не хропіння', () => {
    const d = new SnoreDetector(33);
    let talking = false;
    let snoring = false;
    for (const f of frames(30_000, (t) => (t % 3500 < 1500 ? { db: 55, lowRatio: 0.3, speechRatio: 0.8 } : null))) {
      const s = d.feed(f);
      talking ||= s.talking;
      snoring ||= s.snoring;
    }
    expect(talking).toBe(true);
    expect(snoring).toBe(false);
  });
});

describe('EpochAggregator', () => {
  it('створює епоху кожні 30 с і калібрує фон за 2 хв', () => {
    const agg = new EpochAggregator(T0);
    const out: Epoch[] = [];
    for (const f of frames(5 * 60_000, () => null)) {
      agg.addAudio(f, false, false);
      out.push(...agg.flush(f.t));
    }
    out.push(...agg.flush(T0 + 10 * 60_000));
    expect(out).toHaveLength(10);
    expect(out[1].t - out[0].t).toBe(30_000);
    expect(agg.calibrating).toBe(false);
    expect(agg.baseline).toBeGreaterThan(31);
    expect(agg.baseline).toBeLessThan(35);
    expect(out.every((e) => e.motion === 0 && !e.snore)).toBe(true);
  });

  it('позначає хропіння, рух і пропускає епохи без даних', () => {
    const agg = new EpochAggregator(T0);
    const out: Epoch[] = [];
    const all = frames(6 * 60_000, () => null);
    for (const f of all) {
      const t = f.t - T0;
      if (t >= 4 * 60_000 && t < 5 * 60_000) continue; // розрив: застосунок згорнули
      agg.addAudio(f, t >= CALIBRATION_MS && t < CALIBRATION_MS + 30_000, false);
      if (t >= 3 * 60_000 && t < 3 * 60_000 + 30_000) agg.addMotion(f.t, 0.8);
      else agg.addMotion(f.t, 0.005);
      out.push(...agg.flush(f.t));
    }
    out.push(...agg.flush(T0 + 7 * 60_000));
    const at = (min: number) => out.find((e) => e.t === T0 + min * 60_000);
    expect(at(2)?.snore).toBe(true);
    expect(at(2)?.motion).toBe(0);
    expect(at(3)?.motion).toBeGreaterThan(0.9);
    expect(at(2.5)?.motion).toBe(0);
    expect(at(4)).toBeUndefined();
    expect(at(4.5)).toBeUndefined();
    expect(out).toHaveLength(10);
  });

  it('низькочастотні сплески (хропіння до детектування) не рахуються як активність', () => {
    const agg = new EpochAggregator(T0);
    const out: Epoch[] = [];
    for (const f of frames(3 * 60_000, (t) => (t > CALIBRATION_MS && t % 3500 < 1000 ? { db: 60, lowRatio: 0.85 } : null))) {
      agg.addAudio(f, false, false);
      out.push(...agg.flush(f.t));
    }
    out.push(...agg.flush(T0 + 4 * 60_000));
    expect(out[out.length - 1].motion).toBe(0);
  });

  it('гучні звуки без акселерометра підвищують активність', () => {
    const agg = new EpochAggregator(T0);
    const out: Epoch[] = [];
    for (const f of frames(3 * 60_000, (t) => (t > CALIBRATION_MS && t % 1000 < 300 ? { db: 60 } : null))) {
      agg.addAudio(f, false, false);
      out.push(...agg.flush(f.t));
    }
    out.push(...agg.flush(T0 + 4 * 60_000));
    expect(out[out.length - 1].motion).toBeGreaterThan(0.5);
    expect(out[0].motion).toBe(0);
  });
});
