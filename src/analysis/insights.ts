import type { Night } from '../db/types';
import { factorEffects, type FactorId } from './correlations';
import { sleepDebt } from './debt';
import { DAY_MS, mean, minutesFromNoon, stdDev } from './time';

export type Tone = 'warn' | 'good' | 'info';

export type Insight =
  | { kind: 'debt'; tone: Tone; debtMin: number; earlierMin: number }
  | { kind: 'no_debt'; tone: Tone }
  | { kind: 'irregular'; tone: Tone; sdMin: number }
  | { kind: 'regular'; tone: Tone; sdMin: number }
  | { kind: 'factor_bad'; tone: Tone; factor: FactorId; pct: number }
  | { kind: 'factor_good'; tone: Tone; factor: FactorId; pct: number }
  | { kind: 'trend_up'; tone: Tone; points: number }
  | { kind: 'trend_down'; tone: Tone; points: number }
  | { kind: 'slow_onset'; tone: Tone; min: number }
  | { kind: 'snore'; tone: Tone; min: number }
  | { kind: 'low_deep'; tone: Tone; pct: number }
  | { kind: 'avg_sleep'; tone: Tone; min: number; goalMin: number };

export const MIN_WEEK_NIGHTS = 3;
const MAX_INSIGHTS = 5;
const TONE_ORDER: Record<Tone, number> = { warn: 0, good: 1, info: 2 };

/**
 * 3–5 коротких висновків за останні 7 днів (правила, без «магії»):
 * борг сну, регулярність, найсильніший шкідливий і корисний фактор, тренд оцінки,
 * а також засинання, хропіння й глибокий сон, якщо вони виходять за норму.
 */
export function weeklyInsights(nights: Night[], goalMin: number, now: number): Insight[] {
  const valid = nights.filter((n) => n.totalSleepMin > 0 && n.startedAt <= now);
  const week = valid.filter((n) => n.endedAt > now - 7 * DAY_MS);
  if (week.length < MIN_WEEK_NIGHTS) return [];
  const prev = valid.filter((n) => n.endedAt > now - 14 * DAY_MS && n.endedAt <= now - 7 * DAY_MS);
  const out: Insight[] = [];

  const debt = sleepDebt(valid, goalMin, now);
  if (debt.debtMin >= 60) {
    out.push({ kind: 'debt', tone: 'warn', debtMin: debt.debtMin, earlierMin: Math.min(60, Math.ceil(debt.debtMin / 7 / 15) * 15) });
  } else if (debt.balanceMin < 30) {
    out.push({ kind: 'no_debt', tone: 'good' });
  }

  const sd = stdDev(week.map((n) => minutesFromNoon(n.startedAt)));
  if (sd !== null && sd >= 45) out.push({ kind: 'irregular', tone: 'warn', sdMin: Math.round(sd) });
  else if (sd !== null && sd <= 25) out.push({ kind: 'regular', tone: 'good', sdMin: Math.round(sd) });

  const effects = factorEffects(valid);
  const worst = effects.filter((e) => e.diffPct <= -5).sort((a, b) => a.diffPct - b.diffPct)[0];
  const bestF = effects.filter((e) => e.diffPct >= 5).sort((a, b) => b.diffPct - a.diffPct)[0];
  if (worst) out.push({ kind: 'factor_bad', tone: 'warn', factor: worst.id, pct: -worst.diffPct });
  if (bestF) out.push({ kind: 'factor_good', tone: 'good', factor: bestF.id, pct: bestF.diffPct });

  const avgScore = mean(week.map((n) => n.score))!;
  if (prev.length >= MIN_WEEK_NIGHTS) {
    const delta = Math.round(avgScore - mean(prev.map((n) => n.score))!);
    if (delta >= 3) out.push({ kind: 'trend_up', tone: 'good', points: delta });
    else if (delta <= -3) out.push({ kind: 'trend_down', tone: 'warn', points: -delta });
  }

  const onset = mean(week.map((n) => n.sleepOnsetMin))!;
  if (onset > 25) out.push({ kind: 'slow_onset', tone: 'info', min: Math.round(onset) });
  const snore = mean(week.map((n) => n.snoreMin))!;
  if (snore > 20) out.push({ kind: 'snore', tone: 'info', min: Math.round(snore) });
  const deep = mean(week.map((n) => n.deepPct))!;
  if (deep < 13) out.push({ kind: 'low_deep', tone: 'info', pct: Math.round(deep) });

  if (out.length < 3) out.push({ kind: 'avg_sleep', tone: 'info', min: Math.round(mean(week.map((n) => n.totalSleepMin))!), goalMin });

  return out.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]).slice(0, MAX_INSIGHTS);
}
