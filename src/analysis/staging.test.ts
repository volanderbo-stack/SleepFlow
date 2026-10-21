import { describe, expect, it } from 'vitest';
import { generateDemoNights, mulberry32 } from '../db/demoData';
import type { Epoch, Stage } from '../db/types';
import { buildStages, classifyEpochs, segmentsFromEpochs, smoothShortRuns } from './staging';

const T0 = new Date(2026, 9, 1, 23, 0).getTime();
const mkEpochs = (motions: number[], t0 = T0): Epoch[] =>
  motions.map((motion, i) => ({ t: t0 + i * 30_000, noiseDb: 32, motion, snore: false, talk: false }));

/** Стадія епохи за «справжніми» сегментами демо-ночі. */
function truthAt(segs: { from: number; to: number; stage: Stage }[], t: number): Stage {
  return segs.find((s) => t >= s.from && t < s.to)?.stage ?? 'awake';
}

describe('classifyEpochs', () => {
  it('на синтетичних демо-ночах збігається зі «справжніми» стадіями ≥75%', () => {
    for (const n of generateDemoNights({ now: new Date(2026, 9, 21, 12).getTime(), count: 10, seed: 3 })) {
      const predicted = classifyEpochs(n.epochs);
      const hits = n.epochs.filter((e, i) => predicted[i] === truthAt(n.stages, e.t)).length;
      expect(hits / n.epochs.length).toBeGreaterThan(0.75);
    }
  });

  it('тиха ніч: неспання лише до засинання, глибокий сон на початку ночі', () => {
    const rand = mulberry32(1);
    const motions = [...Array(20).fill(0.7), ...Array.from({ length: 900 }, () => rand() * 0.03)];
    const stages = classifyEpochs(mkEpochs(motions));
    const onset = stages.findIndex((s) => s !== 'awake');
    expect(onset).toBeGreaterThan(14);
    expect(onset).toBeLessThan(25);
    expect(stages.slice(onset).includes('awake')).toBe(false);
    const firstDeep = stages.indexOf('deep');
    expect(firstDeep).toBeGreaterThan(-1);
    expect(firstDeep).toBeLessThan(onset + 900 / 3);
  });

  it('неспокійний сон (фон 0.3–0.5, рідкі сплески) — переважно сон, а не неспання', () => {
    const rand = mulberry32(2);
    const motions = Array.from({ length: 600 }, () => (rand() < 0.08 ? 0.95 : 0.3 + rand() * 0.2));
    const stages = classifyEpochs(mkEpochs(motions));
    expect(stages.filter((s) => s === 'awake').length).toBeLessThan(300);
  });

  it('рух посеред ночі дає пробудження', () => {
    const motions = [...Array(300).fill(0.05), ...Array(10).fill(0.9), ...Array(300).fill(0.05)];
    const stages = classifyEpochs(mkEpochs(motions));
    expect(stages[305]).toBe('awake');
    expect(stages[200]).not.toBe('awake');
  });

  it('порожній вхід', () => {
    expect(classifyEpochs([])).toEqual([]);
  });
});

describe('smoothShortRuns', () => {
  it('прибирає фази коротші за 3 епохи', () => {
    const s: Stage[] = ['light', 'light', 'light', 'deep', 'light', 'light', 'awake', 'awake', 'awake', 'light'];
    expect(smoothShortRuns(s)).toEqual(['light', 'light', 'light', 'light', 'light', 'light', 'awake', 'awake', 'awake', 'awake']);
  });
});

describe('segmentsFromEpochs', () => {
  it('розрив у даних розриває сегмент навіть за тієї ж стадії', () => {
    const a = mkEpochs([0, 0, 0]);
    const b = mkEpochs([0, 0], T0 + 10 * 30_000);
    const segs = segmentsFromEpochs([...a, ...b], ['light', 'light', 'light', 'light', 'light']);
    expect(segs).toHaveLength(2);
    expect(segs[0].to).toBe(T0 + 3 * 30_000);
    expect(segs[1].from).toBe(T0 + 10 * 30_000);
  });

  it('buildStages повертає безперервну гіпнограму', () => {
    const segs = buildStages(mkEpochs(Array(100).fill(0.01)));
    for (let i = 1; i < segs.length; i++) expect(segs[i].from).toBe(segs[i - 1].to);
  });
});
