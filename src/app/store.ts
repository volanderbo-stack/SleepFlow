import { create } from 'zustand';
import * as repo from '../db/repo';
import { DEFAULT_SETTINGS, type Night, type Settings, type TagId } from '../db/types';
import { uk } from '../i18n/uk';
import { MicUnavailableError } from '../tracking/audio';
import { session, type SessionStatus } from '../tracking/session';
import { navigate } from './router';

export interface Tonight {
  alarmOn: boolean;
  /** «HH:MM» */
  alarmTime: string;
  wakeWindow: number;
  tags: TagId[];
}

interface ConfirmRequest {
  text: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

interface AppState {
  ready: boolean;
  nights: Night[];
  settings: Settings;
  tonight: Tonight;
  toast: { id: number; text: string } | null;
  confirm: ConfirmRequest | null;
  tracking: SessionStatus;
  /** Викликати синхронно з onClick — дозволи мікрофона/руху вимагають жесту. */
  startSleep: () => void;
  stopSleep: () => Promise<void>;
  snooze: () => void;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  updateSettings: (patch: Partial<Omit<Settings, 'id'>>) => Promise<void>;
  setTonight: (patch: Partial<Tonight>) => void;
  showToast: (text: string) => void;
  ask: (text: string, danger?: boolean) => Promise<boolean>;
}

const TONIGHT_KEY = 'sleepflow.tonight';
let initPromise: Promise<void> | null = null;

function loadTonight(): Tonight {
  const fallback: Tonight = { alarmOn: true, alarmTime: '07:00', wakeWindow: DEFAULT_SETTINGS.defaultWakeWindow, tags: [] };
  try {
    const raw = localStorage.getItem(TONIGHT_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function saveTonight(t: Tonight) {
  try {
    localStorage.setItem(TONIGHT_KEY, JSON.stringify(t));
  } catch {
    /* приватний режим — не критично */
  }
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  nights: [],
  settings: { ...DEFAULT_SETTINGS },
  tonight: loadTonight(),
  toast: null,
  confirm: null,
  tracking: session.getStatus(),

  startSleep() {
    const { tonight, settings } = get();
    session
      .start({
        alarmTarget: tonight.alarmOn ? nextAlarmTs(tonight.alarmTime, Date.now()) : null,
        wakeWindowMin: tonight.wakeWindow,
        alarmSound: settings.alarmSound,
        tags: tonight.tags,
        saveClips: settings.saveSnoreClips,
        goalMin: settings.sleepGoalMin,
      })
      .catch((e: unknown) => {
        const reason = e instanceof MicUnavailableError ? e.message : 'failed';
        get().showToast(uk.night.micErrors[reason as keyof typeof uk.night.micErrors] ?? uk.night.micErrors.failed);
        console.error(e);
      });
  },

  async stopSleep() {
    const id = await session.stop();
    get().setTonight({ tags: [] });
    await get().refresh();
    if (id !== null) navigate(`/journal/${id}`);
    else get().showToast(uk.night.tooShort);
  },

  snooze() {
    session.snooze();
  },

  init() {
    // StrictMode викликає ефекти двічі — ініціалізуємо лише один раз, інакше демо засіється двічі.
    initPromise ??= (async () => {
      await repo.ensureInitialized();
      await get().refresh();
      set({ ready: true });
    })();
    return initPromise;
  },

  async refresh() {
    const [nights, settings] = await Promise.all([repo.listNights(), repo.getSettings()]);
    set({ nights, settings });
  },

  async updateSettings(patch) {
    const prevGoal = get().settings.sleepGoalMin;
    const settings = await repo.saveSettings(patch);
    set({ settings });
    if (settings.sleepGoalMin !== prevGoal) {
      await repo.rescoreAll(settings.sleepGoalMin);
      await get().refresh();
    }
  },

  setTonight(patch) {
    const tonight = { ...get().tonight, ...patch };
    saveTonight(tonight);
    set({ tonight });
  },

  showToast(text) {
    const id = Date.now();
    set({ toast: { id, text } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 2800);
  },

  ask(text: string, danger = false) {
    return new Promise<boolean>((resolve) => {
      set({
        confirm: {
          text,
          danger,
          resolve: (ok) => {
            set({ confirm: null });
            resolve(ok);
          },
        },
      });
    });
  },
}));

session.subscribe((tracking) => useApp.setState({ tracking }));

/** Найближчий момент у майбутньому з часом «HH:MM». */
export function nextAlarmTs(hhmm: string, now: number): number {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}
