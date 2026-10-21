import type { Epoch, Stage } from '../db/types';

export type WakeReason = 'light' | 'awake' | 'deadline';

export interface WakeInput {
  now: number;
  alarmTarget: number;
  wakeWindowMin: number;
  /** Епохи ночі та їхні стадії (однакової довжини). */
  epochs: Epoch[];
  stages: Stage[];
}

export interface WakeDecision {
  wake: boolean;
  reason: WakeReason | null;
}

/** Дані старші за це вважаються застарілими (розрив) — розумне пробудження не спрацьовує. */
const STALE_MS = 2 * 60_000;
/** Скільки попередніх епох порівнюємо з останньою, щоб побачити наростання руху. */
const RISE_LOOKBACK = 3;

const NO: WakeDecision = { wake: false, reason: null };

/**
 * Розумний будильник:
 *  - до вікна [alarm − window, alarm] — не будимо;
 *  - у вікні будимо при першій епосі «Неспання» або «Легкий» з наростанням руху,
 *    але тільки якщо людина вже спала цієї ночі і дані свіжі;
 *  - у момент alarm (або якщо він уже минув) — будимо завжди.
 */
export function decideWake(i: WakeInput): WakeDecision {
  if (i.now >= i.alarmTarget) return { wake: true, reason: 'deadline' };
  if (i.now < i.alarmTarget - i.wakeWindowMin * 60_000) return NO;

  const n = i.epochs.length;
  if (n === 0 || i.stages.length !== n) return NO;
  const last = i.epochs[n - 1];
  if (i.now - last.t > STALE_MS) return NO;
  if (!i.stages.some((s) => s !== 'awake')) return NO;

  const stage = i.stages[n - 1];
  if (stage === 'awake') return { wake: true, reason: 'awake' };
  if (stage === 'light') {
    const prev = i.epochs.slice(Math.max(0, n - 1 - RISE_LOOKBACK), n - 1);
    const prevAvg = prev.length ? prev.reduce((s, e) => s + e.motion, 0) / prev.length : 0;
    if (prev.length && last.motion > prevAvg && last.motion > 0.02) return { wake: true, reason: 'light' };
  }
  return NO;
}
