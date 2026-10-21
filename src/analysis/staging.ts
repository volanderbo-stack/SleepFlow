import { EPOCH_MS, type Epoch, type Stage, type StageSegment } from '../db/types';
import { clamp } from './time';

/** Перетворює стадію кожної епохи на суцільні сегменти гіпнограми (епохи йдуть без розривів). */
export function segmentsFromStages(stages: Stage[], startedAt: number, epochMs = EPOCH_MS): StageSegment[] {
  const out: StageSegment[] = [];
  stages.forEach((stage, i) => {
    const from = startedAt + i * epochMs;
    const last = out[out.length - 1];
    if (last && last.stage === stage) last.to = from + epochMs;
    else out.push({ from, to: from + epochMs, stage });
  });
  return out;
}

/** Те саме, але за мітками часу епох: розрив у даних завжди розриває сегмент. */
export function segmentsFromEpochs(epochs: Epoch[], stages: Stage[], epochMs = EPOCH_MS): StageSegment[] {
  const out: StageSegment[] = [];
  epochs.forEach((e, i) => {
    const stage = stages[i];
    const last = out[out.length - 1];
    if (last && last.stage === stage && last.to === e.t) last.to = e.t + epochMs;
    else out.push({ from: e.t, to: e.t + epochMs, stage });
  });
  return out;
}

/** Вікно рухомого середнього активності, епох. */
const SMOOTH_WINDOW = 5;
/** Засинання — перші N епох поспіль без активності (5 хв). */
const ONSET_STILL_EPOCHS = 10;
/** Глибокий сон — щонайменше 10 хв низької активності поспіль. */
const DEEP_MIN_RUN = 20;
/** Кандидати в глибокий сон — найспокійніші 30% епох сну... */
const DEEP_SHARE = 0.3;
/** ...але не активніші за цей рівень. */
const DEEP_MAX_ACTIVITY = 0.15;
/** Фаза триває щонайменше 3 епохи (1.5 хв). */
const MIN_STAGE_EPOCHS = 3;
/** Штраф до активності в середній і останній третині ночі: глибокий сон частіше на початку. */
const THIRD_PENALTY = [0, 0.02, 0.04];

function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function smoothed(a: number[]): number[] {
  const half = Math.floor(SMOOTH_WINDOW / 2);
  return a.map((_, i) => {
    const w = a.slice(Math.max(0, i - half), Math.min(a.length, i + half + 1));
    return w.reduce((x, y) => x + y, 0) / w.length;
  });
}

/** Прибирає фази, коротші за minLen епох, приєднуючи їх до попередньої (або наступної) фази. */
export function smoothShortRuns(stages: Stage[], minLen = MIN_STAGE_EPOCHS): Stage[] {
  const out = [...stages];
  if (out.length < minLen) return out;
  // Кожне злиття зменшує кількість відрізків, тож цикл завершується.
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < out.length; ) {
      let j = i;
      while (j < out.length && out[j] === out[i]) j++;
      const fill = i > 0 ? out[i - 1] : out[j];
      if (j - i < minLen && fill !== undefined && fill !== out[i]) {
        out.fill(fill, i, j);
        changed = true;
      }
      i = j;
    }
  }
  return out;
}

/**
 * Стадія кожної епохи за активністю (рух + звукові події, 0..1).
 *  1. Рухоме середнє за 5 епох.
 *  2. Поріг неспання — 85-й перцентиль ночі, обмежений 0.2..0.45 (тиха ніч не отримує фальшивих пробуджень,
 *     неспокійна — не позначається вся як неспання).
 *  3. Засинання — початок перших 5 хв поспіль нижче порога.
 *  4. Глибокий — найспокійніші 30% епох сну (з урахуванням третини ночі), що йдуть поспіль ≥10 хв.
 *  5. Фази коротші за 1.5 хв згладжуються.
 */
export function classifyEpochs(epochs: Epoch[]): Stage[] {
  const n = epochs.length;
  if (n === 0) return [];
  const s = smoothed(epochs.map((e) => e.motion));
  const awakeThr = clamp(percentile(s, 0.85), 0.2, 0.45);

  let onset = n;
  for (let i = 0, run = 0; i < n; i++) {
    run = s[i] < awakeThr ? run + 1 : 0;
    if (run >= ONSET_STILL_EPOCHS) {
      onset = i - run + 1;
      break;
    }
  }

  const stages: Stage[] = s.map((v, i) => (i < onset || v >= awakeThr ? 'awake' : 'light'));

  const sleepIdx = stages.map((st, i) => (st === 'light' ? i : -1)).filter((i) => i >= 0);
  const sleepSpan = Math.max(1, n - onset);
  const adjusted = (i: number) => s[i] + THIRD_PENALTY[Math.min(2, Math.floor(((i - onset) / sleepSpan) * 3))];
  const candidates = new Set(
    [...sleepIdx]
      .sort((a, b) => adjusted(a) - adjusted(b) || a - b)
      .slice(0, Math.floor(sleepIdx.length * DEEP_SHARE))
      .filter((i) => s[i] < DEEP_MAX_ACTIVITY),
  );

  for (let i = 0; i < n; ) {
    if (!candidates.has(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && candidates.has(j)) j++;
    if (j - i >= DEEP_MIN_RUN) for (let k = i; k < j; k++) stages[k] = 'deep';
    i = j;
  }

  return smoothShortRuns(stages);
}

/** Повна гіпнограма ночі з епох. */
export function buildStages(epochs: Epoch[]): StageSegment[] {
  return segmentsFromEpochs(epochs, classifyEpochs(epochs));
}
