import { describe, expect, it } from 'vitest';
import type { Epoch, Stage } from '../db/types';
import { computeNightMetrics } from './metrics';
import { segmentsFromStages } from './staging';

const T0 = new Date(2026, 9, 1, 23, 0).getTime();
const run = (stage: Stage, minutes: number): Stage[] => Array(minutes * 2).fill(stage);

describe('segmentsFromStages', () => {
  it('зливає однакові сусідні епохи', () => {
    const seg = segmentsFromStages(['awake', 'awake', 'light', 'deep', 'deep'], T0);
    expect(seg.map((s) => s.stage)).toEqual(['awake', 'light', 'deep']);
    expect(seg[0].to - seg[0].from).toBe(60_000);
    expect(seg[2].to).toBe(T0 + 5 * 30_000);
  });
});

describe('computeNightMetrics', () => {
  const stages = [
    ...run('awake', 15),
    ...run('light', 60),
    ...run('deep', 30),
    ...run('awake', 1), // мікропробудження — не рахується
    ...run('light', 60),
    ...run('awake', 5), // пробудження
    ...run('light', 45),
    ...run('awake', 3), // фінальне неспання — не пробудження
  ];
  const segs = segmentsFromStages(stages, T0);
  const epochs: Epoch[] = stages.map((_, i) => ({ t: T0 + i * 30_000, noiseDb: 30, motion: 0, snore: i < 20, talk: false }));
  const m = computeNightMetrics(T0, segs, epochs);

  it('рахує засинання, сон і пробудження', () => {
    expect(m.sleepOnsetMin).toBe(15);
    expect(m.totalSleepMin).toBe(195);
    expect(m.awakenings).toBe(1);
  });

  it('рахує частку глибокого сну і хропіння', () => {
    expect(m.deepPct).toBe(Math.round((30 / 195) * 100));
    expect(m.snoreMin).toBe(10);
  });
});
