import { AlarmPlayer } from '../alarm/audioRamp';
import { decideWake, type WakeReason } from '../alarm/smartAlarm';
import { finalizeNight, type RawNight } from '../analysis/finalize';
import { classifyEpochs, segmentsFromEpochs } from '../analysis/staging';
import * as repo from '../db/repo';
import { EPOCH_MS, type AlarmSoundId, type DataGap, type Epoch, type Stage, type TagId } from '../db/types';
import { openMicrophone, WorkletTracker } from './audio';
import type { AudioFrame } from './audioFeatures';
import { CLIP_MS, ClipRecorder } from './clips';
import { MotionTracker, requestMotionPermission } from './motion';
import type { FromWorklet } from './pipeline';
import { WakeLockKeeper, type WakeLockState } from './wakeLock';

/** Розриви коротші за це не показуємо в журналі. */
const MIN_GAP_MS = 60_000;
/** Зберігаємо чернетку ночі кожні N епох — дані не загубляться, якщо браузер закриється. */
const SAVE_EVERY_EPOCHS = 10;
/** Сесії коротші за 2 хв (випадковий старт) не зберігаються. */
const MIN_EPOCHS = 4;
const MAX_CLIPS = 20;
const CLIP_SPACING_MS = 3 * 60_000;
const STATUS_INTERVAL_MS = 500;
/** Скільки чекати на останню епоху від AudioWorklet під час зупинки. */
const STOP_TIMEOUT_MS = 2_000;
export const SNOOZE_MIN = 9;
const VIBRATE_PATTERN = [600, 400, 600, 1400];

export type SessionPhase = 'idle' | 'starting' | 'running' | 'stopping';

export interface SessionStatus {
  phase: SessionPhase;
  startedAt: number;
  nightId: number | null;
  alarmTarget: number | null;
  wakeWindowMin: number;
  epochs: number;
  calibrating: boolean;
  baseline: number;
  level: number;
  /** on — дані йдуть; waiting — дозвіл є, подій ще немає; off — недоступно. */
  motion: 'on' | 'waiting' | 'off';
  wakeLock: WakeLockState;
  gaps: number;
  snoring: boolean;
  clips: number;
  charging: boolean | null;
  lastStage: Stage | null;
  ringing: boolean;
  wakeReason: WakeReason | null;
  /** Час повторного сигналу після «Відкласти». */
  snoozeUntil: number | null;
  screenOffMin: number;
}

export interface LiveFrame extends AudioFrame {
  accel: number;
  snoring: boolean;
  talking: boolean;
}

export interface StartOptions {
  alarmTarget: number | null;
  wakeWindowMin: number;
  alarmSound: AlarmSoundId;
  tags: TagId[];
  saveClips: boolean;
  goalMin: number;
}

const IDLE: SessionStatus = {
  phase: 'idle',
  startedAt: 0,
  nightId: null,
  alarmTarget: null,
  wakeWindowMin: 0,
  epochs: 0,
  calibrating: true,
  baseline: 0,
  level: 0,
  motion: 'off',
  wakeLock: 'off',
  gaps: 0,
  snoring: false,
  clips: 0,
  charging: null,
  lastStage: null,
  ringing: false,
  wakeReason: null,
  snoozeUntil: null,
  screenOffMin: 0,
};

interface BatteryLike extends EventTarget {
  charging: boolean;
}

/** Розриви в даних = пропуски між епохами (аудіопотік зупинявся або мікрофон глушився). */
export function gapsFromEpochs(epochs: Epoch[], minGapMs = MIN_GAP_MS): DataGap[] {
  const out: DataGap[] = [];
  for (let i = 1; i < epochs.length; i++) {
    const from = epochs[i - 1].t + EPOCH_MS;
    if (epochs[i].t - from >= minGapMs) out.push({ from, to: epochs[i].t });
  }
  return out;
}

/**
 * Нічна сесія. Аналіз звуку живе в AudioWorklet (аудіопотік), тож на Android він працює
 * і з вимкненим екраном; основний потік лише зберігає епохи, вирішує, коли будити, і малює UI.
 * Мелодія на час будильника заздалегідь запланована в аудіографі — прозвучить, навіть якщо JS призупинено.
 */
export class SleepSession {
  private status: SessionStatus = { ...IDLE };
  private statusListeners = new Set<(s: SessionStatus) => void>();
  private frameListeners = new Set<(f: LiveFrame) => void>();
  private lastStatusEmit = 0;

  private opts: StartOptions | null = null;
  private stream: MediaStream | null = null;
  private tracker = new WorkletTracker();
  private motion = new MotionTracker();
  private wakeLock = new WakeLockKeeper();
  private alarm = new AlarmPlayer();
  private clipRecorder: ClipRecorder | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private vibrateTimer: ReturnType<typeof setInterval> | null = null;
  private epochs: Epoch[] = [];
  private stages: Stage[] = [];
  private motionBatch: [number, number][] = [];
  private accelAcc = 0;
  private motionGranted = false;
  private tracking = false;
  private otherStarts: number[] = [];
  private epochsSinceSave = 0;
  private saveChain: Promise<unknown> = Promise.resolve();
  private clipPromise: Promise<void> | null = null;
  private lastClipAt = 0;
  private snoringNow = false;
  private wokeAt: number | null = null;
  private hiddenSince: number | null = null;
  private hiddenMs = 0;
  private stopResolve: ((epochs: Epoch[]) => void) | null = null;
  private battery: BatteryLike | null = null;

  getStatus(): SessionStatus {
    return this.status;
  }

  /** Останні епохи поточної сесії (для debug-панелі). */
  recentEpochs(n = 8): Epoch[] {
    return this.epochs.slice(-n);
  }

  subscribe(fn: (s: SessionStatus) => void): () => void {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  onFrame(fn: (f: LiveFrame) => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  /** Викликати прямо з обробника натискання: дозволи на iOS вимагають жесту користувача. */
  async start(opts: StartOptions): Promise<void> {
    if (this.status.phase !== 'idle') return;
    this.setStatus({ ...IDLE, phase: 'starting' }, true);
    // Усе, що потребує жесту, стартує синхронно, до першого await.
    const motionP = requestMotionPermission();
    const micP = openMicrophone();
    this.alarm.prime();
    void document.documentElement.requestFullscreen?.().catch(() => undefined);

    try {
      this.stream = await micP;
    } catch (e) {
      this.setStatus({ ...IDLE }, true);
      void document.exitFullscreen?.().catch(() => undefined);
      throw e;
    }
    this.motionGranted = await motionP;

    this.opts = opts;
    const startedAt = Date.now();
    this.epochs = [];
    this.stages = [];
    this.motionBatch = [];
    this.accelAcc = 0;
    this.epochsSinceSave = 0;
    this.lastClipAt = 0;
    this.snoringNow = false;
    this.wokeAt = null;
    this.hiddenSince = document.visibilityState === 'hidden' ? startedAt : null;
    this.hiddenMs = 0;
    this.clipRecorder = opts.saveClips ? new ClipRecorder(this.stream) : null;

    try {
      await this.tracker.start(this.stream, this.onWorklet);
    } catch (e) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.setStatus({ ...IDLE }, true);
      throw e;
    }
    this.tracker.post({ type: 'start', startedAt });
    this.tracker.post({ type: 'alarm', at: opts.alarmTarget });
    if (opts.alarmTarget) this.alarm.scheduleAt(opts.alarmSound, opts.alarmTarget);

    if (this.motionGranted) {
      this.motion.start((t, d) => {
        this.motionBatch.push([t, d]);
        this.accelAcc += d;
      });
    }
    this.tracking = true;
    this.wakeLock.onChange((wakeLock) => this.setStatus({ wakeLock }, true));
    const wakeLock = await this.wakeLock.acquire();
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    void this.watchBattery();

    this.otherStarts = (await repo.listNights()).map((n) => n.startedAt);
    const nightId = await repo.addNight(finalizeNight(this.raw(startedAt, startedAt, false), this.otherStarts, opts.goalMin));

    // Запасний таймер: повтор після «Відкласти» і дедлайн, якщо аудіопотік зупинився.
    this.timer = setInterval(this.tick, 1000);
    this.setStatus(
      {
        phase: 'running',
        startedAt,
        nightId,
        alarmTarget: opts.alarmTarget,
        wakeWindowMin: opts.wakeWindowMin,
        wakeLock,
        motion: this.motionGranted ? 'waiting' : 'off',
      },
      true,
    );
  }

  /** «Відкласти»: тиша на 9 хв, потім будильник знову (вже без розумного вікна). */
  snooze() {
    if (!this.status.ringing) return;
    this.stopRinging();
    const at = Date.now() + SNOOZE_MIN * 60_000;
    this.alarm.scheduleAt(this.opts?.alarmSound ?? 'dawn', at);
    this.setStatus({ ringing: false, snoozeUntil: at }, true);
  }

  /** Debug: переносить будильник на найближчий час, щоб перевірити його без очікування до ранку. */
  debugSetAlarm(inMs: number, wakeWindowMin: number) {
    if (this.status.phase !== 'running') return;
    const at = Date.now() + inMs;
    this.tracker.post({ type: 'alarm', at });
    this.alarm.scheduleAt(this.opts?.alarmSound ?? 'dawn', at);
    this.setStatus({ alarmTarget: at, wakeWindowMin, snoozeUntil: null }, true);
  }

  debugRingNow() {
    if (this.status.phase === 'running' && !this.status.ringing) void this.ring(Date.now(), 'deadline');
  }

  /** Завершує сесію («Вимкнути» або ручна зупинка). Повертає id збереженої ночі або null, якщо даних замало. */
  async stop(): Promise<number | null> {
    if (this.status.phase !== 'running') return null;
    this.setStatus({ phase: 'stopping' }, true);
    const now = Date.now();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopRinging();
    this.alarm.stop();
    await this.stopTracking(now);
    this.closeHidden(now);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    await this.wakeLock.release();
    void document.exitFullscreen?.().catch(() => undefined);

    const nightId = this.status.nightId;
    let result: number | null = null;
    if (nightId !== null) {
      await this.saveChain;
      if (this.epochs.length < MIN_EPOCHS) {
        await repo.deleteNight(nightId);
      } else {
        await this.save(this.wokeAt ?? now, true);
        result = nightId;
      }
    }
    this.setStatus({ ...IDLE }, true);
    return result;
  }

  private onWorklet = (m: FromWorklet) => {
    const now = Date.now();
    switch (m.type) {
      case 'frame': {
        this.snoringNow = m.snoring;
        if (this.motionBatch.length) {
          this.tracker.post({ type: 'motion', samples: this.motionBatch });
          this.motionBatch = [];
        }
        if (document.visibilityState === 'visible') {
          const live: LiveFrame = { ...m.frame, accel: this.accelAcc, snoring: m.snoring, talking: m.talking };
          this.frameListeners.forEach((fn) => fn(live));
        }
        this.accelAcc = 0;
        this.setStatus({
          calibrating: m.calibrating,
          baseline: m.baseline,
          level: m.frame.db,
          snoring: m.snoring,
          motion: !this.motionGranted ? 'off' : this.motion.receiving ? 'on' : 'waiting',
        });
        break;
      }
      case 'snoreStart':
        this.maybeRecordClip(now);
        break;
      case 'epochs':
        this.addEpochs(m.epochs);
        if (this.epochsSinceSave >= SAVE_EVERY_EPOCHS) void this.save(now, false);
        this.checkAlarm(now, true);
        break;
      case 'deadline':
        if (this.status.alarmTarget !== null && !this.status.ringing) void this.ring(now, 'deadline');
        break;
      case 'stopped':
        this.addEpochs(m.epochs);
        this.stopResolve?.(m.epochs);
        this.stopResolve = null;
        break;
    }
  };

  private addEpochs(epochs: Epoch[]) {
    if (!epochs.length) return;
    this.epochs.push(...epochs);
    this.stages = classifyEpochs(this.epochs);
    this.epochsSinceSave += epochs.length;
    this.setStatus(
      {
        epochs: this.epochs.length,
        gaps: gapsFromEpochs(this.epochs).length,
        lastStage: this.stages[this.stages.length - 1] ?? null,
        screenOffMin: this.screenOffMin(Date.now()),
      },
      true,
    );
  }

  private tick = () => {
    const now = Date.now();
    if (this.status.ringing) return;
    if (this.status.snoozeUntil !== null) {
      if (now >= this.status.snoozeUntil) void this.ring(now, 'deadline');
      return;
    }
    this.checkAlarm(now, false);
  };

  /** Дедлайн перевіряємо завжди, розумне пробудження — на кожній новій епосі. */
  private checkAlarm(now: number, freshEpoch: boolean) {
    const { alarmTarget, wakeWindowMin, ringing } = this.status;
    if (alarmTarget === null || ringing) return;
    if (now < alarmTarget && !freshEpoch) return;
    const d = decideWake({ now, alarmTarget, wakeWindowMin, epochs: this.epochs, stages: this.stages });
    if (d.wake && d.reason) void this.ring(now, d.reason);
  }

  private async ring(now: number, reason: WakeReason) {
    if (this.status.ringing) return;
    this.wokeAt ??= now;
    this.setStatus({ ringing: true, wakeReason: this.status.wakeReason ?? reason, snoozeUntil: null }, true);
    // Якщо запланована мелодія вже звучить — start() її не перезапускає.
    this.alarm.start(this.opts?.alarmSound ?? 'dawn');
    if ('vibrate' in navigator) {
      const vib = () => navigator.vibrate(VIBRATE_PATTERN);
      vib();
      this.vibrateTimer = setInterval(vib, VIBRATE_PATTERN.reduce((a, b) => a + b, 0));
    }
    // Мікрофон вимикаємо: момент пробудження зафіксовано, а на iOS активний запис приглушує динамік.
    await this.stopTracking(now);
    void this.save(now, false);
  }

  private stopRinging() {
    this.alarm.stop();
    if (this.vibrateTimer) clearInterval(this.vibrateTimer);
    this.vibrateTimer = null;
    if ('vibrate' in navigator) navigator.vibrate(0);
  }

  /** Зупиняє мікрофон і датчики, забираючи з AudioWorklet останню незавершену епоху. */
  private async stopTracking(now: number) {
    if (!this.tracking) return;
    this.tracking = false;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.stopResolve = null;
        resolve();
      }, STOP_TIMEOUT_MS);
      this.stopResolve = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.tracker.post({ type: 'stop', at: now });
    });
    this.motion.stop();
    await this.tracker.stop();
    await this.clipPromise;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private maybeRecordClip(now: number) {
    const rec = this.clipRecorder;
    const nightId = this.status.nightId;
    if (!rec || !rec.supported || rec.busy || nightId === null) return;
    if (this.status.clips >= MAX_CLIPS || now - this.lastClipAt < CLIP_SPACING_MS) return;
    this.lastClipAt = now;
    this.clipPromise = rec.record(CLIP_MS).then(async (res) => {
      // Зберігаємо лише якщо хропіння тривало весь фрагмент (епізод > 10 с).
      if (!res || !this.snoringNow) return;
      await repo.addClip({ nightId, t: now, blob: res.blob, durationSec: res.durationSec });
      this.setStatus({ clips: this.status.clips + 1 }, true);
    });
  }

  private screenOffMin(now: number): number {
    const ms = this.hiddenMs + (this.hiddenSince !== null ? now - this.hiddenSince : 0);
    return Math.round(ms / 60_000);
  }

  private closeHidden(now: number) {
    if (this.hiddenSince === null) return;
    this.hiddenMs += now - this.hiddenSince;
    this.hiddenSince = null;
  }

  private raw(startedAt: number, endedAt: number, final: boolean): RawNight {
    const o = this.opts!;
    return {
      startedAt,
      endedAt,
      alarmTarget: o.alarmTarget,
      wakeWindowMin: o.wakeWindowMin,
      actualWakeAt: final || this.wokeAt ? (this.wokeAt ?? endedAt) : null,
      epochs: this.epochs,
      stages: segmentsFromEpochs(this.epochs, this.stages.length === this.epochs.length ? this.stages : classifyEpochs(this.epochs)),
      gaps: gapsFromEpochs(this.epochs),
      screenOffMin: this.screenOffMin(endedAt),
      tags: o.tags,
      note: '',
      isDemo: false,
    };
  }

  private save(now: number, final: boolean): Promise<unknown> {
    const nightId = this.status.nightId;
    const opts = this.opts;
    if (nightId === null || !opts) return Promise.resolve();
    this.epochsSinceSave = 0;
    const raw = this.raw(this.status.startedAt, now, final);
    const night = { ...finalizeNight(raw, this.otherStarts, opts.goalMin), id: nightId };
    this.saveChain = this.saveChain.then(() => repo.putNight(night)).catch((e) => console.error('save failed', e));
    return this.saveChain;
  }

  private onVisibility = () => {
    const now = Date.now();
    if (document.visibilityState === 'hidden') {
      this.hiddenSince ??= now;
      void this.save(now, false);
    } else {
      this.closeHidden(now);
      void this.tracker.resume();
      // Поки сторінка спала, дедлайн міг минути (а мелодія вже грає з аудіографа).
      this.tick();
      this.setStatus({ screenOffMin: this.screenOffMin(now) }, true);
    }
  };

  private onPageHide = () => {
    void this.save(Date.now(), false);
  };

  private async watchBattery() {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (!nav.getBattery || this.battery) {
      if (this.battery) this.setStatus({ charging: this.battery.charging }, true);
      return;
    }
    try {
      this.battery = await nav.getBattery();
      this.setStatus({ charging: this.battery.charging }, true);
      this.battery.addEventListener('chargingchange', () => this.setStatus({ charging: this.battery!.charging }, true));
    } catch {
      /* Battery API недоступний (iOS, Firefox) */
    }
  }

  private setStatus(patch: Partial<SessionStatus>, force = false) {
    this.status = { ...this.status, ...patch };
    const now = Date.now();
    if (!force && now - this.lastStatusEmit < STATUS_INTERVAL_MS) return;
    this.lastStatusEmit = now;
    this.statusListeners.forEach((fn) => fn(this.status));
  }
}

export const session = new SleepSession();
