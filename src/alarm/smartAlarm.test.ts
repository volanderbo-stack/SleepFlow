import { describe, expect, it } from 'vitest';
import type { Epoch, Stage } from '../db/types';
import { decideWake } from './smartAlarm';

const ALARM = new Date(2026, 9, 22, 7, 0).getTime();
const MIN = 60_000;

/** Ніч, що закінчується в момент `end`: стадії та рух по епохах. */
function night(end: number, spec: [Stage, number][]) {
  const total = spec.length;
  const epochs: Epoch[] = spec.map(([, motion], i) => ({ t: end - (total - i) * 30_000, noiseDb: 30, motion, snore: false, talk: false }));
  return { epochs, stages: spec.map(([s]) => s) };
}

const sleepThen = (tail: [Stage, number][]): [Stage, number][] => [
  ...Array.from({ length: 20 }, (): [Stage, number] => ['deep', 0.01]),
  ...tail,
];

describe('decideWake', () => {
  it('легка фаза з наростанням руху у вікні — будимо', () => {
    const now = ALARM - 20 * MIN;
    const n = night(now, sleepThen([['light', 0.05], ['light', 0.05], ['light', 0.06], ['light', 0.2]]));
    expect(decideWake({ now, alarmTarget: ALARM, wakeWindowMin: 30, ...n })).toEqual({ wake: true, reason: 'light' });
  });

  it('легка фаза без наростання руху — чекаємо', () => {
    const now = ALARM - 20 * MIN;
    const n = night(now, sleepThen([['light', 0.2], ['light', 0.2], ['light', 0.2], ['light', 0.1]]));
    expect(decideWake({ now, alarmTarget: ALARM, wakeWindowMin: 30, ...n }).wake).toBe(false);
  });

  it('неспання у вікні після сну — будимо', () => {
    const now = ALARM - 5 * MIN;
    const n = night(now, sleepThen([['awake', 0.8]]));
    expect(decideWake({ now, alarmTarget: ALARM, wakeWindowMin: 30, ...n })).toEqual({ wake: true, reason: 'awake' });
  });

  it('немає легкої фази у вікні — будимо рівно в час будильника', () => {
    const n = (now: number) => night(now, sleepThen(Array.from({ length: 10 }, (): [Stage, number] => ['deep', 0.01])));
    for (const before of [29, 15, 1]) {
      const now = ALARM - before * MIN;
      expect(decideWake({ now, alarmTarget: ALARM, wakeWindowMin: 30, ...n(now) }).wake).toBe(false);
    }
    expect(decideWake({ now: ALARM, alarmTarget: ALARM, wakeWindowMin: 30, ...n(ALARM) })).toEqual({ wake: true, reason: 'deadline' });
  });

  it('вікно вже минуло — будимо одразу', () => {
    const now = ALARM + 3 * MIN;
    expect(decideWake({ now, alarmTarget: ALARM, wakeWindowMin: 30, epochs: [], stages: [] })).toEqual({ wake: true, reason: 'deadline' });
  });

  it('до вікна не будимо навіть у легкій фазі', () => {
    const now = ALARM - 45 * MIN;
    const n = night(now, sleepThen([['light', 0.05], ['light', 0.05], ['light', 0.05], ['light', 0.5]]));
    expect(decideWake({ now, alarmTarget: ALARM, wakeWindowMin: 30, ...n }).wake).toBe(false);
  });

  it('людина ще не засинала — у вікні не будимо раніше', () => {
    const now = ALARM - 10 * MIN;
    const n = night(now, Array.from({ length: 30 }, (): [Stage, number] => ['awake', 0.7]));
    expect(decideWake({ now, alarmTarget: ALARM, wakeWindowMin: 30, ...n }).wake).toBe(false);
  });

  it('застарілі дані (розрив) — розумне пробудження не спрацьовує', () => {
    const now = ALARM - 10 * MIN;
    const n = night(now - 5 * MIN, sleepThen([['awake', 0.9]]));
    expect(decideWake({ now, alarmTarget: ALARM, wakeWindowMin: 30, ...n }).wake).toBe(false);
  });
});
