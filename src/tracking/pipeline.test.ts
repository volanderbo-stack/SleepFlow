import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../db/demoData';
import type { Epoch } from '../db/types';
import { bandRatiosFromPower } from './audioFeatures';
import { CALIBRATION_MS, EpochAggregator } from './epochs';
import { powerSpectrum } from './fft';
import { FrameBuilder, TrackingPipeline, type FromWorklet } from './pipeline';

const SR = 48000;
const BLOCK = 128;

function sine(freq: number, n: number, amp = 0.5, phase0 = 0): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * (i + phase0)) / SR);
  return out;
}

describe('powerSpectrum', () => {
  it('пік на частоті синусоїди', () => {
    const p = powerSpectrum(sine(1000, 4096));
    const peak = p.indexOf(Math.max(...p));
    expect(Math.abs(peak * (SR / 4096) - 1000)).toBeLessThan(SR / 4096);
  });

  it('200 Гц — діапазон хропіння, 2 кГц — мовний', () => {
    const low = bandRatiosFromPower(powerSpectrum(sine(200, 4096)), SR / 4096);
    const high = bandRatiosFromPower(powerSpectrum(sine(2000, 4096)), SR / 4096);
    expect(low.lowRatio).toBeGreaterThan(0.95);
    expect(high.lowRatio).toBeLessThan(0.05);
    expect(high.speechRatio).toBeGreaterThan(0.95);
  });
});

describe('FrameBuilder', () => {
  it('10 кадрів на секунду, тиша (нулі) — без кадрів', () => {
    const fb = new FrameBuilder(SR);
    let frames = 0;
    for (let i = 0; i < SR / BLOCK; i++) frames += fb.push(sine(300, BLOCK, 0.1, i * BLOCK), i).length;
    expect(frames).toBeGreaterThanOrEqual(9);
    expect(frames).toBeLessThanOrEqual(10);
    expect(fb.push(new Float32Array(SR), 0)).toHaveLength(0);
  });
});

/** Ганяє конвеєр як AudioWorklet: блоки по 128 семплів, час рухається разом зі звуком. */
function run(p: TrackingPipeline, t0: number, seconds: number, gen: (tSec: number) => number): FromWorklet[] {
  const out: FromWorklet[] = [];
  const rand = mulberry32(5);
  const block = new Float32Array(BLOCK);
  for (let s = 0; s < seconds * SR; s += BLOCK) {
    for (let i = 0; i < BLOCK; i++) {
      const tSec = (s + i) / SR;
      block[i] = (rand() * 2 - 1) * 0.001 + gen(tSec);
    }
    out.push(...p.process(block, t0 + ((s + BLOCK) / SR) * 1000));
  }
  return out;
}

describe('TrackingPipeline', () => {
  const T0 = 1_700_000_000_000;

  it('епохи йдуть кожні 30 с, дедлайн будильника спрацьовує один раз', () => {
    const p = new TrackingPipeline(SR);
    p.handle({ type: 'start', startedAt: T0 });
    p.handle({ type: 'alarm', at: T0 + 45_000 });
    const msgs = run(p, T0, 95, () => 0);
    const epochs = msgs.filter((m) => m.type === 'epochs').flatMap((m) => (m.type === 'epochs' ? m.epochs : []));
    expect(epochs.map((e) => e.t - T0)).toEqual([0, 30_000, 60_000]);
    const deadlines = msgs.filter((m) => m.type === 'deadline');
    expect(deadlines).toHaveLength(1);
    expect((deadlines[0] as { t: number }).t - T0).toBeGreaterThanOrEqual(45_000);
    expect((deadlines[0] as { t: number }).t - T0).toBeLessThan(45_100);
  });

  it('ритмічне низькочастотне хропіння — snoreStart і епохи з хропінням', () => {
    const p = new TrackingPipeline(SR);
    p.handle({ type: 'start', startedAt: T0 });
    const snore = (t: number) => (t > 5 && t % 3.5 < 1 ? 0.3 * Math.sin(2 * Math.PI * 180 * t) : 0);
    const msgs = run(p, T0, 70, snore);
    expect(msgs.some((m) => m.type === 'snoreStart')).toBe(true);
    const epochs = msgs.flatMap((m) => (m.type === 'epochs' ? m.epochs : []));
    expect(epochs.at(-1)?.snore).toBe(true);
  });

  it('stop закриває останню незавершену епоху', () => {
    const p = new TrackingPipeline(SR);
    p.handle({ type: 'start', startedAt: T0 });
    run(p, T0, 40, () => 0);
    const [stopped] = p.handle({ type: 'stop', at: T0 + 40_000 });
    expect(stopped.type).toBe('stopped');
    expect(stopped.type === 'stopped' && stopped.epochs.map((e) => e.t - T0)).toEqual([30_000]);
  });
});

describe('EpochAggregator без датчиків руху', () => {
  it('епохи без даних акселерометра (екран вимкнено) оцінюються за звуком', () => {
    const agg = new EpochAggregator(0);
    const out: Epoch[] = [];
    for (let t = 0; t < CALIBRATION_MS + 60_000; t += 100) {
      const loud = t > CALIBRATION_MS + 30_000 && t % 1000 < 300;
      agg.addAudio({ t, db: loud ? 60 : 32, lowRatio: 0.3, speechRatio: 0.4 }, false, false);
      if (t < CALIBRATION_MS) agg.addMotion(t, 0.005); // на початку екран увімкнено
      out.push(...agg.flush(t));
    }
    out.push(...agg.flush(CALIBRATION_MS + 120_000));
    expect(out.at(-1)!.motion).toBeGreaterThan(0.5);
  });
});
