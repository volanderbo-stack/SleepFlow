import { EPOCH_MS, type Epoch, type StageSegment } from '../db/types';

export interface NightMetrics {
  sleepOnsetMin: number;
  totalSleepMin: number;
  awakenings: number;
  deepPct: number;
  snoreMin: number;
}

/** Пробудження коротші за це не рахуються (мікропробудження). */
const MIN_AWAKENING_MS = 2 * 60_000;

const min = (ms: number) => ms / 60_000;

export function computeNightMetrics(startedAt: number, stages: StageSegment[], epochs: Epoch[]): NightMetrics {
  const firstSleep = stages.find((s) => s.stage !== 'awake');
  const sleepOnsetMin = firstSleep ? Math.round(min(firstSleep.from - startedAt)) : 0;

  let sleepMs = 0;
  let deepMs = 0;
  for (const s of stages) {
    if (s.stage === 'awake') continue;
    sleepMs += s.to - s.from;
    if (s.stage === 'deep') deepMs += s.to - s.from;
  }

  // Пробудження — епізоди неспання між засинанням і останнім сегментом сну.
  let lastSleepIdx = -1;
  stages.forEach((s, i) => {
    if (s.stage !== 'awake') lastSleepIdx = i;
  });
  const firstSleepIdx = firstSleep ? stages.indexOf(firstSleep) : -1;
  let awakenings = 0;
  for (let i = firstSleepIdx + 1; i < lastSleepIdx; i++) {
    const s = stages[i];
    if (s.stage === 'awake' && s.to - s.from >= MIN_AWAKENING_MS) awakenings++;
  }

  const snoreEpochs = epochs.filter((e) => e.snore).length;

  return {
    sleepOnsetMin,
    totalSleepMin: Math.round(min(sleepMs)),
    awakenings,
    deepPct: sleepMs > 0 ? Math.round((deepMs / sleepMs) * 100) : 0,
    snoreMin: Math.round(min(snoreEpochs * EPOCH_MS)),
  };
}
