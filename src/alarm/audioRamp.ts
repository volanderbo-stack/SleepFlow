import type { AlarmSoundId } from '../db/types';

/** Гучність наростає від 0 до 100% за цей час (ТЗ: 60–90 с). */
export const RAMP_SEC = 75;

const note = (semitonesFromA4: number) => 440 * Math.pow(2, semitonesFromA4 / 12);
// Ноти відносно A4
const C4 = -9, E4 = -5, G4 = -2, A4 = 0, B4 = 2, C5 = 3, D5 = 5, E5 = 7, G5 = 10, C6 = 15, E6 = 19, G6 = 22;

interface Pattern {
  /** Тривалість такту, с. */
  bar: number;
  play: (ctx: AudioContext, out: AudioNode, at: number, barIndex: number) => void;
}

function tone(ctx: AudioContext, out: AudioNode, freq: number, at: number, dur: number, opts: { type?: OscillatorType; attack?: number; gain?: number } = {}) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.value = freq;
  const peak = opts.gain ?? 0.3;
  const attack = opts.attack ?? 0.01;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

function bell(ctx: AudioContext, out: AudioNode, freq: number, at: number) {
  tone(ctx, out, freq, at, 2.2, { gain: 0.25 });
  tone(ctx, out, freq * 2.76, at, 1.2, { gain: 0.06 });
  tone(ctx, out, freq * 5.4, at, 0.6, { gain: 0.02 });
}

function chirp(ctx: AudioContext, out: AudioNode, at: number, base: number) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.setValueAtTime(base, at);
  osc.frequency.exponentialRampToValueAtTime(base * 1.6, at + 0.07);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.12, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + 0.12);
}

const PATTERNS: Record<AlarmSoundId, Pattern> = {
  // М'які акорди, що повільно змінюються
  dawn: {
    bar: 4.8,
    play(ctx, out, at, i) {
      const chords = [
        [C4, E4, G4, B4],
        [A4 - 12, C4, E4, G4],
        [-14, -10, -7, -3], // F3 A3 C4 E4
        [-12 + 2, D5 - 12, G4, B4],
      ];
      for (const s of chords[i % chords.length]) tone(ctx, out, note(s), at, 4.6, { attack: 1.4, gain: 0.08 });
      tone(ctx, out, note(chords[i % chords.length][0] - 12), at, 4.6, { attack: 1.4, gain: 0.06, type: 'triangle' });
    },
  },
  // Дзвіночки
  chimes: {
    bar: 3.2,
    play(ctx, out, at, i) {
      const seq = i % 2 === 0 ? [E6, G6, C6, G5] : [C6, E6, D5 + 12, G5];
      seq.forEach((s, k) => bell(ctx, out, note(s), at + k * 0.8));
    },
  },
  // Птахи на світанку
  forest: {
    bar: 2.6,
    play(ctx, out, at, i) {
      const r = (k: number) => ((Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
      const groups = 2 + Math.floor(r(1) * 2);
      for (let gIdx = 0; gIdx < groups; gIdx++) {
        const start = at + r(gIdx + 2) * 2;
        const base = 2400 + r(gIdx + 7) * 1600;
        for (let c = 0; c < 3; c++) chirp(ctx, out, start + c * 0.13, base);
      }
    },
  },
  // Тихе піаніно (арпеджіо)
  piano: {
    bar: 2.4,
    play(ctx, out, at, i) {
      const seq = i % 2 === 0 ? [C4, E4, G4, C5, E5, C5] : [A4 - 12, C4, E4, A4, C5, A4];
      seq.forEach((s, k) => tone(ctx, out, note(s), at + k * 0.4, 1.6, { type: 'triangle', gain: 0.2 }));
    },
  },
};

/**
 * Будильник на Web Audio (без зовнішніх файлів). AudioContext створюється в prime()
 * під час натискання «Почати сон» — інакше браузер не дасть грати звук уранці без жесту.
 */
export class AlarmPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBarAt = 0;
  private bar = 0;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

  prime() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);
    void this.ctx.resume().catch(() => undefined);
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  /** Починає мелодію з наростанням гучності за rampSec. durationSec — автозупинка (для прев'ю). */
  start(sound: AlarmSoundId, rampSec = RAMP_SEC, durationSec?: number) {
    this.prime();
    const ctx = this.ctx!;
    const master = this.master!;
    void ctx.resume().catch(() => undefined);
    this.halt();
    const pattern = PATTERNS[sound] ?? PATTERNS.dawn;
    const t0 = ctx.currentTime + 0.05;
    master.gain.cancelScheduledValues(t0);
    master.gain.setValueAtTime(0.001, t0);
    master.gain.linearRampToValueAtTime(1, t0 + rampSec);
    this.nextBarAt = t0;
    this.bar = 0;
    const schedule = () => {
      // Плануємо на 2 с наперед — таймер може трохи запізнюватися.
      while (this.nextBarAt < ctx.currentTime + 2) {
        pattern.play(ctx, master, this.nextBarAt, this.bar++);
        this.nextBarAt += pattern.bar;
      }
    };
    schedule();
    this.timer = setInterval(schedule, 500);
    if (durationSec) this.stopTimer = setTimeout(() => this.stop(), durationSec * 1000);
  }

  stop() {
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(0, t + 0.3);
    }
    this.halt();
  }

  async close() {
    this.stop();
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
  }

  private halt() {
    if (this.timer) clearInterval(this.timer);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.timer = null;
    this.stopTimer = null;
  }
}
