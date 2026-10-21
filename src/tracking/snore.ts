import type { AudioFrame } from './audioFeatures';

/**
 * Евристичний детектор хропіння та розмов уві сні.
 *
 * Звук розбивається на «сплески» — безперервні кадри, гучніші за фон на LOUD_DB.
 *  - Сплеск хропіння: 0.3–2.5 с, переважно низькі частоти (lowRatio > SNORE_LOW_RATIO).
 *    Хропіння вмикається, коли 3 інтервали поспіль між такими сплесками — 2–6 с (ритм дихання).
 *    Вимикається, якщо SNORE_TIMEOUT_MS немає нового сплеску.
 *  - Розмова: сплеск ≥0.8 с з переважанням мовного діапазону і без низькочастотної домінанти.
 */
const LOUD_DB = 6;
const SNORE_LOW_RATIO = 0.65;
const SNORE_MIN_MS = 300;
const SNORE_MAX_MS = 2500;
const PERIOD_MIN_MS = 2000;
const PERIOD_MAX_MS = 6000;
const PERIODIC_INTERVALS = 3;
const SNORE_TIMEOUT_MS = 10_000;
const TALK_MIN_MS = 800;
const TALK_SPEECH_RATIO = 0.55;

export interface DetectorState {
  snoring: boolean;
  talking: boolean;
  /** true на кадрі, де почався епізод хропіння. */
  episodeStarted: boolean;
  /** Заповнено на кадрі, де епізод завершився. */
  episodeEnded: { from: number; to: number } | null;
}

export class SnoreDetector {
  baseline: number;
  private burstStart = -1;
  private lowSum = 0;
  private speechSum = 0;
  private frames = 0;
  private onsets: number[] = [];
  private snoring = false;
  private episodeFrom = 0;
  private lastSnoreBurst = 0;
  private talkingUntil = 0;

  constructor(baseline = 35) {
    this.baseline = baseline;
  }

  feed(f: AudioFrame): DetectorState {
    const state: DetectorState = { snoring: false, talking: false, episodeStarted: false, episodeEnded: null };
    const loud = f.db > this.baseline + LOUD_DB;

    if (loud) {
      if (this.burstStart < 0) this.burstStart = f.t;
      this.lowSum += f.lowRatio;
      this.speechSum += f.speechRatio;
      this.frames++;
    } else if (this.burstStart >= 0) {
      this.endBurst(f.t, state);
    }

    if (this.snoring && f.t - this.lastSnoreBurst > SNORE_TIMEOUT_MS) {
      this.snoring = false;
      this.onsets = [];
      state.episodeEnded = { from: this.episodeFrom, to: this.lastSnoreBurst };
    }

    state.snoring = this.snoring;
    state.talking = f.t < this.talkingUntil;
    return state;
  }

  private endBurst(now: number, state: DetectorState) {
    const duration = now - this.burstStart;
    const low = this.lowSum / this.frames;
    const speech = this.speechSum / this.frames;
    const start = this.burstStart;
    this.burstStart = -1;
    this.lowSum = this.speechSum = this.frames = 0;

    if (duration >= SNORE_MIN_MS && duration <= SNORE_MAX_MS && low > SNORE_LOW_RATIO) {
      const prev = this.onsets[this.onsets.length - 1];
      // Ритм зламався до початку епізоду — починаємо рахувати інтервали спочатку.
      if (!this.snoring && prev !== undefined && (start - prev < PERIOD_MIN_MS || start - prev > PERIOD_MAX_MS)) {
        this.onsets = [];
      }
      this.onsets.push(start);
      if (this.onsets.length > PERIODIC_INTERVALS + 1) this.onsets.shift();

      const periodic =
        this.onsets.length === PERIODIC_INTERVALS + 1 &&
        this.onsets.slice(1).every((t, i) => {
          const d = t - this.onsets[i];
          return d >= PERIOD_MIN_MS && d <= PERIOD_MAX_MS;
        });
      if (this.snoring || periodic) {
        if (!this.snoring) {
          this.snoring = true;
          this.episodeFrom = this.onsets[0];
          state.episodeStarted = true;
        }
        this.lastSnoreBurst = now;
      }
      return;
    }

    if (duration >= TALK_MIN_MS && speech > TALK_SPEECH_RATIO && low <= SNORE_LOW_RATIO) {
      this.talkingUntil = now + 1000;
    }
  }
}
