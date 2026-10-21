import { AlarmPlayer } from '../alarm/audioRamp';
import { decideWake, type WakeReason } from '../alarm/smartAlarm';
import { finalizeNight, type RawNight } from '../analysis/finalize';
import { classifyEpochs, segmentsFromEpochs } from '../analysis/staging';
import * as repo from '../db/repo';
import { EPOCH_MS, type AlarmSoundId, type DataGap, type Epoch, type Stage, type TagId } from '../db/types';
import { AudioAnalyzer, openMicrophone } from './audio';
import type { AudioFrame } from './audioFeatures';
import { CLIP_MS, ClipRecorder } from './clips';
import { EpochAggregator } from './epochs';
import { MotionTracker, requestMotionPermission } from './motion';
import { SnoreDetector } from './snore';
import { WakeLockKeeper, type WakeLockState } from './wakeLock';

const FRAME_MS = 100;
/** Пауза між кадрами, довша за це, вважається розривом (таймер заморожено, вкладку згорнуто). */
const GAP_DETECT_MS = 5_000;
/** Розриви коротші за це не показуємо в журналі. */
const MIN_GAP_MS = 30_000;
/** Зберігаємо чернетку ночі кожні N епох — дані не загубляться, якщо браузер закриється. */
const SAVE_EVERY_EPOCHS = 10;
/** Сесії коротші за 2 хв (випадковий старт) не зберігаються. */
const MIN_EPOCHS = 4;
const MAX_CLIPS = 20;
const CLIP_SPACING_MS = 3 * 60_000;
const STATUS_INTERVAL_MS = 500;
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
};

interface BatteryLike extends EventTarget {
  charging: boolean;
}

/**
 * Нічна сесія: мікрофон + акселерометр → епохи → гіпнограма, з періодичним збереженням,
 * і розумний будильник. Коли будильник дзвонить, запис зупиняється — момент пробудження зафіксовано.
 */
export class SleepSession {
  private status: SessionStatus = { ...IDLE };
  private statusListeners = new Set<(s: SessionStatus) => void>();
  private frameListeners = new Set<(f: LiveFrame) => void>();
  private lastStatusEmit = 0;

  private opts: StartOptions | null = null;
  private stream: MediaStream | null = null;
  private audio = new AudioAnalyzer();
  private motion = new MotionTracker();
  private wakeLock = new WakeLockKeeper();
  private alarm = new AlarmPlayer();
  private clipRecorder: ClipRecorder | null = null;
  private aggregator: EpochAggregator | null = null;
  private detector = new SnoreDetector();
  private timer: ReturnType<typeof setInterval> | null = null;
  private vibrateTimer: ReturnType<typeof setInterval> | null = null;
  private epochs: Epoch[] = [];
  private stages: Stage[] = [];
  private gaps: DataGap[] = [];
  private hiddenSince: number | null = null;
  private lastTick = 0;
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
    this.gaps = [];
    this.hiddenSince = null;
    this.lastTick = 0;
    this.accelAcc = 0;
    this.epochsSinceSave = 0;
    this.lastClipAt = 0;
    this.snoringNow = false;
    this.wokeAt = null;
    this.aggregator = new EpochAggregator(startedAt);
    this.detector = new SnoreDetector();
    this.clipRecorder = opts.saveClips ? new ClipRecorder(this.stream) : null;

    this.audio.start(this.stream);
    await this.audio.resume();
    if (this.motionGranted) {
      this.motion.start((t, d) => {
        this.aggregator?.addMotion(t, d);
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

    this.timer = setInterval(this.tick, FRAME_MS);
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
    this.setStatus({ ringing: false, snoozeUntil: Date.now() + SNOOZE_MIN * 60_000 }, true);
  }

  /** Debug: переносить будильник на найближчий час, щоб перевірити його без очікування до ранку. */
  debugSetAlarm(inMs: number, wakeWindowMin: number) {
    if (this.status.phase !== 'running') return;
    this.setStatus({ alarmTarget: Date.now() + inMs, wakeWindowMin, snoozeUntil: null }, true);
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
    await this.stopTracking(now);
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

  private tick = () => {
    const now = Date.now();
    if (this.lastTick && now - this.lastTick > GAP_DETECT_MS && this.tracking) this.addGap(this.lastTick, now);
    this.lastTick = now;

    if (this.status.ringing) return;
    if (this.status.snoozeUntil !== null) {
      if (now >= this.status.snoozeUntil) void this.ring(now, 'deadline');
      return;
    }
    if (!this.tracking || document.visibilityState === 'hidden' || !this.aggregator) {
      this.checkAlarm(now, false);
      return;
    }
    if (!this.audio.running) void this.audio.resume();

    const f = this.audio.read(now);
    if (!f) return;
    this.detector.baseline = this.aggregator.baseline;
    const st = this.detector.feed(f);
    this.snoringNow = st.snoring;
    this.aggregator.addAudio(f, st.snoring, st.talking);
    if (st.episodeStarted) this.maybeRecordClip(now);

    const live: LiveFrame = { ...f, accel: this.accelAcc, snoring: st.snoring, talking: st.talking };
    this.accelAcc = 0;
    this.frameListeners.forEach((fn) => fn(live));

    const done = this.aggregator.flush(now);
    if (done.length) {
      this.epochs.push(...done);
      this.stages = classifyEpochs(this.epochs);
      this.epochsSinceSave += done.length;
      if (this.epochsSinceSave >= SAVE_EVERY_EPOCHS) void this.save(now, false);
    }
    this.checkAlarm(now, done.length > 0);

    this.setStatus({
      epochs: this.epochs.length,
      calibrating: this.aggregator.calibrating,
      baseline: this.aggregator.baseline,
      level: f.db,
      snoring: st.snoring,
      lastStage: this.stages[this.stages.length - 1] ?? null,
      motion: !this.motionGranted ? 'off' : this.motion.receiving ? 'on' : 'waiting',
    });
  };

  /** Перевіряє дедлайн щотику, а розумне пробудження — на кожній новій епосі. */
  private checkAlarm(now: number, freshEpoch: boolean) {
    const { alarmTarget, wakeWindowMin } = this.status;
    if (alarmTarget === null) return;
    if (now < alarmTarget && !freshEpoch) return;
    const d = decideWake({ now, alarmTarget, wakeWindowMin, epochs: this.epochs, stages: this.stages });
    if (d.wake && d.reason) void this.ring(now, d.reason);
  }

  private async ring(now: number, reason: WakeReason) {
    if (this.status.ringing) return;
    this.wokeAt ??= now;
    this.setStatus({ ringing: true, wakeReason: this.status.wakeReason ?? reason, snoozeUntil: null }, true);
    // Мікрофон вимикаємо до старту мелодії: на iOS активний запис приглушує динамік.
    await this.stopTracking(now);
    this.alarm.start(this.opts?.alarmSound ?? 'dawn');
    if ('vibrate' in navigator) {
      const vib = () => navigator.vibrate(VIBRATE_PATTERN);
      vib();
      this.vibrateTimer = setInterval(vib, VIBRATE_PATTERN.reduce((a, b) => a + b, 0));
    }
    void this.save(now, false);
  }

  private stopRinging() {
    this.alarm.stop();
    if (this.vibrateTimer) clearInterval(this.vibrateTimer);
    this.vibrateTimer = null;
    if ('vibrate' in navigator) navigator.vibrate(0);
  }

  /** Зупиняє мікрофон і датчики, закриваючи останню незавершену епоху. */
  private async stopTracking(now: number) {
    if (!this.tracking) return;
    this.tracking = false;
    if (this.hiddenSince !== null) this.addGap(this.hiddenSince, now);
    this.hiddenSince = null;
    if (this.aggregator) {
      this.epochs.push(...this.aggregator.flush(now + EPOCH_MS));
      this.stages = classifyEpochs(this.epochs);
    }
    this.motion.stop();
    await this.audio.stop();
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
      gaps: this.gaps.filter((g) => g.to - g.from >= MIN_GAP_MS),
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

  private addGap(from: number, to: number) {
    const last = this.gaps[this.gaps.length - 1];
    if (last && from <= last.to) last.to = Math.max(last.to, to);
    else this.gaps.push({ from, to });
    this.setStatus({ gaps: this.gaps.filter((g) => g.to - g.from >= MIN_GAP_MS).length }, true);
  }

  private onVisibility = () => {
    const now = Date.now();
    if (!this.tracking) return;
    if (document.visibilityState === 'hidden') {
      this.hiddenSince = now;
      void this.save(now, false);
    } else if (this.hiddenSince !== null) {
      this.addGap(this.hiddenSince, now);
      this.hiddenSince = null;
      this.lastTick = now;
      void this.audio.resume();
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
