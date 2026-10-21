import type { Night } from '../db/types';
import { mean, minutesFromNoon, nightDate } from './time';

export type Period = 'week' | 'month' | 'year';

export interface StatPoint {
  key: string;
  start: number;
  nights: number;
  sleepH: number | null;
  score: number | null;
  /** Хвилини від полудня. */
  bedtime: number | null;
  /** Хвилини від полудня (07:00 = 1140). */
  wake: number | null;
  snoreMin: number | null;
  deepPct: number | null;
}

export interface PeriodSummary {
  nights: number;
  avgScore: number | null;
  avgSleepMin: number | null;
  avgBedtime: number | null;
  avgWake: number | null;
  avgSnoreMin: number | null;
  avgDeepPct: number | null;
}

const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

/** Дата останньої ночі: до 18:00 це вчорашній вечір, після — сьогоднішній. */
export function lastNightDate(now: number): Date {
  const d = new Date(now);
  if (d.getHours() < 18) d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Початок періоду (за датою ночі). */
export function periodStart(period: Period, now: number): number {
  const today = lastNightDate(now);
  if (period === 'year') {
    const d = new Date(today.getFullYear(), today.getMonth() - 11, 1);
    return d.getTime();
  }
  const days = period === 'week' ? 7 : 30;
  const d = new Date(today);
  d.setDate(d.getDate() - (days - 1));
  return d.getTime();
}

export function nightsInPeriod(nights: Night[], period: Period, now: number): Night[] {
  const from = periodStart(period, now);
  return nights.filter((n) => nightDate(n.startedAt).getTime() >= from && n.startedAt <= now && n.totalSleepMin > 0);
}

function aggregate(key: string, start: number, ns: Night[]): StatPoint {
  const m = (f: (n: Night) => number) => mean(ns.map(f));
  return {
    key,
    start,
    nights: ns.length,
    sleepH: round1(m((n) => n.totalSleepMin / 60)),
    score: ns.length ? Math.round(m((n) => n.score)!) : null,
    bedtime: ns.length ? Math.round(m((n) => minutesFromNoon(n.startedAt))!) : null,
    wake: ns.length ? Math.round(m((n) => minutesFromNoon(n.actualWakeAt ?? n.endedAt))!) : null,
    snoreMin: ns.length ? Math.round(m((n) => n.snoreMin)!) : null,
    deepPct: ns.length ? Math.round(m((n) => n.deepPct)!) : null,
  };
}

/** Точки для графіків: по днях (тиждень, місяць) або по місяцях (рік). Дні без ночей — null. */
export function buildSeries(nights: Night[], period: Period, now: number): StatPoint[] {
  const inPeriod = nightsInPeriod(nights, period, now);
  const from = periodStart(period, now);
  const out: StatPoint[] = [];
  if (period === 'year') {
    const first = new Date(from);
    for (let i = 0; i < 12; i++) {
      const s = new Date(first.getFullYear(), first.getMonth() + i, 1);
      const e = new Date(first.getFullYear(), first.getMonth() + i + 1, 1);
      const ns = inPeriod.filter((n) => {
        const d = nightDate(n.startedAt).getTime();
        return d >= s.getTime() && d < e.getTime();
      });
      out.push(aggregate(`${s.getFullYear()}-${s.getMonth()}`, s.getTime(), ns));
    }
    return out;
  }
  const days = period === 'week' ? 7 : 30;
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    const ns = inPeriod.filter((n) => nightDate(n.startedAt).getTime() === d.getTime());
    out.push(aggregate(d.toISOString().slice(0, 10), d.getTime(), ns));
  }
  return out;
}

export function summarize(ns: Night[]): PeriodSummary {
  const m = (f: (n: Night) => number) => {
    const v = mean(ns.map(f));
    return v === null ? null : Math.round(v);
  };
  return {
    nights: ns.length,
    avgScore: m((n) => n.score),
    avgSleepMin: m((n) => n.totalSleepMin),
    avgBedtime: m((n) => minutesFromNoon(n.startedAt)),
    avgWake: m((n) => minutesFromNoon(n.actualWakeAt ?? n.endedAt)),
    avgSnoreMin: m((n) => n.snoreMin),
    avgDeepPct: m((n) => n.deepPct),
  };
}
