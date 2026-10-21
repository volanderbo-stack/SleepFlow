import type { Night } from '../db/types';
import { mean, median, minutesFromNoon, noonMinutesToClock } from './time';

export const IDEAL_MIN_NIGHTS = 14;
const STEP = 15;
/** Ночі в межах ±30 хв від кандидата вважаються «лягли в цей час». */
const NEIGHBOR_MIN = 30;
const MIN_SUPPORT = 3;
/** Згладжування: середня кандидата підтягується до загальної так, ніби є ще стільки «середніх» ночей. */
const PRIOR_NIGHTS = 4;
/** Штраф (балів за хвилину), якщо з таким часом лягання не виходить виспатися до звичного підйому. */
const SHORTFALL_PENALTY = 0.15;

export interface IdealBedtime {
  /** Хвилини від півночі. */
  bedtimeClock: number;
  avgScore: number;
  support: number;
  /** Звичний час підйому (медіана), хвилини від півночі. */
  wakeClock: number;
  /** Найпізніший час лягання, щоб спати за ціллю до звичного підйому. */
  latestForGoal: number;
  usesDemo: boolean;
}

/**
 * Персональна модель (після 14+ ночей): час лягання (крок 15 хв) з найвищою середньою оцінкою
 * серед ночей поруч (±30 хв, зі згладжуванням до загальної середньої — щоб 2–3 вдалі ночі не перемагали),
 * і зі штрафом, якщо після такого лягання до звичного підйому не встигнути виспатися.
 */
export function idealBedtime(nights: Night[], goalMin: number): IdealBedtime | null {
  const valid = nights.filter((n) => n.totalSleepMin > 0);
  if (valid.length < IDEAL_MIN_NIGHTS) return null;

  const pts = valid.map((n) => ({ bed: minutesFromNoon(n.startedAt), score: n.score, onset: n.sleepOnsetMin }));
  const wake = median(valid.map((n) => minutesFromNoon(n.actualWakeAt ?? n.endedAt)))!;
  const latency = mean(pts.map((p) => p.onset)) ?? 15;
  const globalAvg = mean(pts.map((p) => p.score))!;

  const lo = Math.floor(Math.min(...pts.map((p) => p.bed)) / STEP) * STEP;
  const hi = Math.ceil(Math.max(...pts.map((p) => p.bed)) / STEP) * STEP;
  let best: { c: number; adj: number; avg: number; support: number } | null = null;
  for (let c = lo; c <= hi; c += STEP) {
    const near = pts.filter((p) => Math.abs(p.bed - c) <= NEIGHBOR_MIN);
    if (near.length < MIN_SUPPORT) continue;
    const avg = mean(near.map((p) => p.score))!;
    const shrunk = (avg * near.length + globalAvg * PRIOR_NIGHTS) / (near.length + PRIOR_NIGHTS);
    const shortfall = Math.max(0, c + latency + goalMin - wake);
    const adj = shrunk - shortfall * SHORTFALL_PENALTY;
    if (!best || adj > best.adj || (adj === best.adj && near.length > best.support)) best = { c, adj, avg, support: near.length };
  }
  if (!best) return null;

  const latest = Math.floor((wake - goalMin - latency) / STEP) * STEP;
  return {
    bedtimeClock: noonMinutesToClock(best.c),
    avgScore: Math.round(best.avg),
    support: best.support,
    wakeClock: noonMinutesToClock(wake),
    latestForGoal: noonMinutesToClock(latest),
    usesDemo: valid.some((n) => n.isDemo),
  };
}
