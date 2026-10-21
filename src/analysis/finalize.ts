import type { Night } from '../db/types';
import { computeNightMetrics } from './metrics';
import { bedtimeDeviation, computeSleepScore } from './score';

export type RawNight = Omit<Night, 'sleepOnsetMin' | 'totalSleepMin' | 'awakenings' | 'deepPct' | 'snoreMin' | 'score'>;

/** Рахує всі похідні метрики та оцінку ночі. previousStarts — startedAt інших ночей. */
export function finalizeNight(raw: RawNight, previousStarts: number[], goalMin: number): Night {
  const m = computeNightMetrics(raw.startedAt, raw.stages, raw.epochs);
  const score = computeSleepScore({
    ...m,
    goalMin,
    bedtimeDeviationMin: bedtimeDeviation(raw.startedAt, previousStarts),
  });
  return { ...raw, ...m, score };
}

/** Перераховує оцінки (наприклад, після зміни цілі сну). Повертає лише змінені ночі. */
export function rescoreNights(nights: Night[], goalMin: number): Night[] {
  const starts = nights.map((n) => n.startedAt);
  const changed: Night[] = [];
  for (const n of nights) {
    const next = finalizeNight(n, starts, goalMin);
    if (next.score !== n.score) changed.push(next);
  }
  return changed;
}
