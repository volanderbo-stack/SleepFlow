import { clamp, median, minutesFromNoon } from './time';

/**
 * Sleep Score (0–100) — зважена сума п'яти складників, кожен нормований до 0..1:
 *
 *  - Тривалість, 40%: сон / ціль. Пересип понад 125% цілі трохи знижує бал.
 *  - Глибокий сон, 20%: частка глибокого сну; 20% і більше — максимум.
 *  - Пробудження, 15%: одне пробудження — норма, кожне наступне −20%.
 *  - Латентність, 10%: засинання ≤15 хв — максимум, ≥60 хв — нуль.
 *  - Регулярність, 15%: відхилення часу лягання від медіани попередніх 7 ночей;
 *    ≤15 хв — максимум, ≥90 хв — нуль. Без історії складник не штрафує.
 */
export const SCORE_WEIGHTS = {
  duration: 40,
  deep: 20,
  awakenings: 15,
  latency: 10,
  regularity: 15,
} as const;

export interface ScoreInput {
  totalSleepMin: number;
  goalMin: number;
  deepPct: number;
  awakenings: number;
  sleepOnsetMin: number;
  /** Відхилення часу лягання від звичного, хв; null — немає історії. */
  bedtimeDeviationMin: number | null;
}

export interface ScoreBreakdown {
  duration: number;
  deep: number;
  awakenings: number;
  latency: number;
  regularity: number;
  total: number;
}

const linearDown = (v: number, good: number, bad: number) => clamp((bad - v) / (bad - good), 0, 1);

export function scoreBreakdown(i: ScoreInput): ScoreBreakdown {
  const ratio = i.goalMin > 0 ? i.totalSleepMin / i.goalMin : 0;
  const durationPart = ratio <= 1.25 ? clamp(ratio, 0, 1) : clamp(1 - (ratio - 1.25) * 0.8, 0.6, 1);
  const parts = {
    duration: durationPart * SCORE_WEIGHTS.duration,
    deep: clamp(i.deepPct / 20, 0, 1) * SCORE_WEIGHTS.deep,
    awakenings: clamp(1 - Math.max(0, i.awakenings - 1) * 0.2, 0, 1) * SCORE_WEIGHTS.awakenings,
    latency: linearDown(i.sleepOnsetMin, 15, 60) * SCORE_WEIGHTS.latency,
    regularity:
      (i.bedtimeDeviationMin === null ? 1 : linearDown(i.bedtimeDeviationMin, 15, 90)) * SCORE_WEIGHTS.regularity,
  };
  const total = Math.round(Object.values(parts).reduce((a, b) => a + b, 0));
  return { ...parts, total: clamp(total, 0, 100) };
}

export function computeSleepScore(i: ScoreInput): number {
  return scoreBreakdown(i).total;
}

/** Відхилення часу лягання від медіани попередніх (до 7) ночей, хв. */
export function bedtimeDeviation(startedAt: number, previousStarts: number[]): number | null {
  const recent = previousStarts.filter((t) => t < startedAt).sort((a, b) => b - a).slice(0, 7);
  const m = median(recent.map(minutesFromNoon));
  if (m === null) return null;
  return Math.abs(minutesFromNoon(startedAt) - m);
}
