import { finalizeNight, type RawNight } from '../analysis/finalize';
import { segmentsFromStages } from '../analysis/staging';
import { EPOCH_MS, type Epoch, type Night, type Stage, type TagId } from './types';

/** Детермінований генератор псевдовипадкових чисел (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussFactory(rand: () => number) {
  return () => {
    const u = Math.max(rand(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
}

const TAG_PROBABILITY: Record<TagId, number> = {
  coffee_late: 0.3,
  sport: 0.35,
  alcohol: 0.12,
  stress: 0.25,
  screen: 0.5,
  late_food: 0.2,
};

/** Хвилини глибокого сну за циклом: більше на початку ночі. */
const DEEP_BY_CYCLE = [38, 26, 14, 6, 3];

export interface DemoOptions {
  count?: number;
  seed?: number;
  now?: number;
  goalMin?: number;
  wakeWindowMin?: number;
}

export function generateDemoNights(opts: DemoOptions = {}): Night[] {
  const { count = 30, seed = 42, now = Date.now(), goalMin = 480, wakeWindowMin = 30 } = opts;
  const rand = mulberry32(seed);
  const gauss = gaussFactory(rand);
  const between = (a: number, b: number) => a + rand() * (b - a);

  // Остання ніч закінчується сьогодні вранці, якщо вже після 10:00, інакше — вчора.
  const anchor = new Date(now);
  if (anchor.getHours() < 10) anchor.setDate(anchor.getDate() - 1);
  anchor.setHours(0, 0, 0, 0);

  const nights: Night[] = [];
  for (let i = count; i >= 1; i--) {
    const evening = new Date(anchor);
    evening.setDate(anchor.getDate() - i);
    const dow = evening.getDay(); // 5 = п'ятниця, 6 = субота
    const weekend = dow === 5 || dow === 6;

    const tags = (Object.keys(TAG_PROBABILITY) as TagId[]).filter((tag) => {
      const p = tag === 'alcohol' && weekend ? 0.4 : TAG_PROBABILITY[tag];
      return rand() < p;
    });
    const has = (t: TagId) => tags.includes(t);

    // Час лягання (хвилини від півночі вечірнього дня; >1440 — вже після півночі).
    let bedMin = 23 * 60 + 10 + gauss() * 25;
    if (weekend) bedMin += 45;
    if (has('stress')) bedMin += 20;
    if (has('screen')) bedMin += 15;
    if (has('coffee_late')) bedMin += 20;
    const startedAt = evening.getTime() + Math.round(bedMin) * 60_000;

    const morning = new Date(evening);
    morning.setDate(evening.getDate() + 1);
    let alarmTarget: number | null = null;
    let endedAt: number;
    if (weekend) {
      endedAt = morning.getTime() + Math.round(8.5 * 60 + gauss() * 30) * 60_000;
    } else {
      alarmTarget = morning.getTime() + 7 * 60 * 60_000;
      endedAt = alarmTarget - Math.round(between(0, wakeWindowMin - 5)) * 60_000;
    }

    let latency = 8 + Math.abs(gauss()) * 6;
    if (has('coffee_late')) latency += 18;
    if (has('stress')) latency += 14;
    if (has('screen')) latency += 6;

    let deepFactor = 1;
    if (has('coffee_late')) deepFactor *= 0.65;
    if (has('sport')) deepFactor *= 1.2;
    if (has('late_food')) deepFactor *= 0.85;
    if (has('stress')) deepFactor *= 0.85;

    let wakeProb = 0.22;
    if (has('alcohol')) wakeProb += 0.3;
    if (has('late_food')) wakeProb += 0.15;
    if (has('stress')) wakeProb += 0.15;
    if (has('coffee_late')) wakeProb += 0.1;

    const total = Math.floor((endedAt - startedAt) / EPOCH_MS);
    const finalAwake = 1 + Math.floor(rand() * 4);
    const stages: Stage[] = [];
    const push = (stage: Stage, epochs: number) => {
      for (let k = 0; k < epochs && stages.length < total - finalAwake; k++) stages.push(stage);
    };

    push('awake', Math.round(latency * 2));
    for (let cycle = 0; stages.length < total - finalAwake; cycle++) {
      const cycleEpochs = Math.round((90 + gauss() * 8) * 2);
      let deepMin = DEEP_BY_CYCLE[Math.min(cycle, DEEP_BY_CYCLE.length - 1)] * deepFactor;
      if (has('alcohol')) deepMin *= cycle === 0 ? 1.15 : 0.6;
      const deepEpochs = Math.max(0, Math.round((deepMin + gauss() * 3) * 2));
      const leadLight = Math.round(between(10, 16) * 2);
      push('light', leadLight);
      push('deep', deepEpochs);
      push('light', Math.max(10, cycleEpochs - leadLight - deepEpochs));
      if (rand() < wakeProb) push('awake', Math.round(between(2, 8) * 2));
    }
    while (stages.length < total) stages.push('awake');

    // Сигнали епох, узгоджені зі стадіями.
    const baseNoise = 30 + gauss() * 2;
    let snoreProne = 0.003 + (rand() < 0.3 ? 0.008 : 0);
    if (has('alcohol')) snoreProne += 0.04;
    let snoreLeft = 0;
    const epochs: Epoch[] = stages.map((stage, k) => {
      let motion: number;
      let noise: number;
      let talk = false;
      if (stage === 'awake') {
        motion = between(0.55, 1);
        noise = baseNoise + between(6, 14);
        talk = rand() < 0.02;
      } else if (stage === 'light') {
        motion = rand() < 0.06 ? between(0.4, 0.6) : between(0.08, 0.28);
        noise = baseNoise + rand() * 4;
      } else {
        motion = rand() * 0.05;
        noise = baseNoise + rand() * 2;
      }
      let snore = false;
      if (stage === 'awake') snoreLeft = 0;
      else {
        if (snoreLeft === 0 && rand() < snoreProne * 0.15) snoreLeft = Math.round(between(6, 30));
        if (snoreLeft > 0) {
          snore = true;
          snoreLeft--;
          noise += between(12, 20);
        }
      }
      return {
        t: startedAt + k * EPOCH_MS,
        noiseDb: Math.round(noise * 10) / 10,
        motion: Math.round(motion * 1000) / 1000,
        snore,
        talk,
      };
    });

    const raw: RawNight = {
      startedAt,
      endedAt,
      alarmTarget,
      wakeWindowMin,
      actualWakeAt: endedAt,
      epochs,
      stages: segmentsFromStages(stages, startedAt),
      tags,
      note: '',
      isDemo: true,
    };
    nights.push(
      finalizeNight(
        raw,
        nights.map((n) => n.startedAt),
        goalMin,
      ),
    );
  }
  return nights;
}
