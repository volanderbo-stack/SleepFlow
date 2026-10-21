export type Stage = 'awake' | 'light' | 'deep';

export const TAG_IDS = ['coffee_late', 'sport', 'alcohol', 'stress', 'screen', 'late_food'] as const;
export type TagId = (typeof TAG_IDS)[number];

export const ALARM_SOUNDS = ['dawn', 'chimes', 'forest', 'piano'] as const;
export type AlarmSoundId = (typeof ALARM_SOUNDS)[number];

/** Агреговані дані за одну епоху (30 с). t — мітка часу початку епохи, мс. */
export interface Epoch {
  t: number;
  noiseDb: number;
  /** Нормована активність 0..1 (рух + звук). */
  motion: number;
  snore: boolean;
  talk: boolean;
}

export interface StageSegment {
  from: number;
  to: number;
  stage: Stage;
}

/** Проміжок без даних (втрата Wake Lock, застосунок згорнули). */
export interface DataGap {
  from: number;
  to: number;
}

export interface Night {
  id?: number;
  startedAt: number;
  endedAt: number;
  alarmTarget: number | null;
  wakeWindowMin: number;
  actualWakeAt: number | null;
  epochs: Epoch[];
  stages: StageSegment[];
  gaps?: DataGap[];
  sleepOnsetMin: number;
  totalSleepMin: number;
  awakenings: number;
  deepPct: number;
  snoreMin: number;
  score: number;
  tags: TagId[];
  note: string;
  isDemo: boolean;
}

export interface SnoreClip {
  id?: number;
  nightId: number;
  t: number;
  blob: Blob;
  durationSec: number;
}

export interface Settings {
  id: 'main';
  sleepGoalMin: number;
  defaultWakeWindow: number;
  alarmSound: AlarmSoundId;
  saveSnoreClips: boolean;
  theme: 'night';
  onboardingDone: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'main',
  sleepGoalMin: 8 * 60,
  defaultWakeWindow: 30,
  alarmSound: 'dawn',
  saveSnoreClips: false,
  theme: 'night',
  onboardingDone: false,
};

export const EPOCH_MS = 30_000;
