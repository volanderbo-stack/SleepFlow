import { TAG_IDS, type Night, type TagId } from '../db/types';
import { mean, median, minutesFromNoon, nightDate, percentile } from './time';

/** Теги-нотатки плюс похідні фактори, які видно з самих даних. */
export type FactorId = TagId | 'late_bed' | 'weekend';
export const FACTOR_IDS: FactorId[] = [...TAG_IDS, 'late_bed', 'weekend'];

/** Мінімум ночей у кожній групі (з фактором і без), щоб показувати висновок. */
export const MIN_GROUP = 3;
/** «Пізнє лягання» — на стільки хвилин пізніше за медіану. */
const LATE_BED_MIN = 45;

export interface FactorEffect {
  id: FactorId;
  withN: number;
  withoutN: number;
  avgWith: number;
  avgWithout: number;
  /** Різниця середньої оцінки, % від «без фактора». Від'ємна — фактор шкодить. */
  diffPct: number;
  onsetDiffMin: number;
  deepDiffPp: number;
  awakeningsDiff: number;
  sleepDiffMin: number;
  /** Скільки поганих ночей мали цей фактор. */
  inBad: number;
  badTotal: number;
}

export interface FactorContext {
  medianBedtime: number;
}

export function factorContext(nights: Night[]): FactorContext {
  return { medianBedtime: median(nights.map((n) => minutesFromNoon(n.startedAt))) ?? 660 };
}

export function hasFactor(n: Night, id: FactorId, ctx: FactorContext): boolean {
  if (id === 'late_bed') return minutesFromNoon(n.startedAt) - ctx.medianBedtime >= LATE_BED_MIN;
  if (id === 'weekend') {
    const dow = nightDate(n.startedAt).getDay();
    return dow === 5 || dow === 6;
  }
  return n.tags.includes(id);
}

/** Погана ніч — серед 25% найгірших для цієї людини. */
export function badThreshold(nights: Night[]): number {
  return percentile(
    nights.map((n) => n.score),
    0.25,
  ) ?? 0;
}

const avg = (ns: Night[], f: (n: Night) => number) => mean(ns.map(f)) ?? 0;

/** Вплив кожного фактора на сон, від найсильнішого. Фактори з малою вибіркою відкидаються. */
export function factorEffects(nights: Night[]): FactorEffect[] {
  const valid = nights.filter((n) => n.totalSleepMin > 0);
  const ctx = factorContext(valid);
  const bad = badThreshold(valid);
  const badNights = valid.filter((n) => n.score <= bad);
  const out: FactorEffect[] = [];
  for (const id of FACTOR_IDS) {
    const withF = valid.filter((n) => hasFactor(n, id, ctx));
    const without = valid.filter((n) => !hasFactor(n, id, ctx));
    if (withF.length < MIN_GROUP || without.length < MIN_GROUP) continue;
    const avgWith = avg(withF, (n) => n.score);
    const avgWithout = avg(without, (n) => n.score);
    out.push({
      id,
      withN: withF.length,
      withoutN: without.length,
      avgWith: Math.round(avgWith),
      avgWithout: Math.round(avgWithout),
      diffPct: avgWithout > 0 ? Math.round(((avgWith - avgWithout) / avgWithout) * 100) : 0,
      onsetDiffMin: Math.round(avg(withF, (n) => n.sleepOnsetMin) - avg(without, (n) => n.sleepOnsetMin)),
      deepDiffPp: Math.round(avg(withF, (n) => n.deepPct) - avg(without, (n) => n.deepPct)),
      awakeningsDiff: Math.round((avg(withF, (n) => n.awakenings) - avg(without, (n) => n.awakenings)) * 10) / 10,
      sleepDiffMin: Math.round(avg(withF, (n) => n.totalSleepMin) - avg(without, (n) => n.totalSleepMin)),
      inBad: badNights.filter((n) => hasFactor(n, id, ctx)).length,
      badTotal: badNights.length,
    });
  }
  return out.sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct) || b.withN - a.withN);
}
