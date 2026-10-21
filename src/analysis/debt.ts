import type { Night } from '../db/types';
import { DAY_MS } from './time';

export interface SleepDebt {
  /** Борг, хв (≥0). */
  debtMin: number;
  /** Σ(ціль − сон); від'ємне значення — профіцит. */
  balanceMin: number;
  surplus: boolean;
  nights: number;
}

/**
 * Борг сну: Σ(ціль − фактичний сон) за ночі, що закінчились за останні `days` днів.
 * Ночі без запису не рахуються (невідомо, скільки людина спала).
 */
export function sleepDebt(nights: Night[], goalMin: number, now: number, days = 7): SleepDebt {
  const from = now - days * DAY_MS;
  const recent = nights.filter((n) => n.endedAt > from && n.endedAt <= now && n.totalSleepMin > 0);
  const balanceMin = recent.reduce((s, n) => s + (goalMin - n.totalSleepMin), 0);
  return { debtMin: Math.max(0, balanceMin), balanceMin, surplus: balanceMin < 0, nights: recent.length };
}
