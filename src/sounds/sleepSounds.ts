export const SOUND_IDS = ['white', 'pink', 'brown', 'rain'] as const;
export type SoundId = (typeof SOUND_IDS)[number];
export const TIMER_OPTIONS = [15, 30, 45, 60] as const;

/** Наприкінці таймера звук плавно згасає за стільки секунд. */
export const FADE_SEC = 30;

export interface SoundsState {
  playing: boolean;
  id: SoundId | null;
  endsAt: number | null;
  volume: number;
}

type NoiseColor = 'white' | 'pink' | 'brown';

/** Буфер шуму заданого «кольору» (кілька секунд, програється по колу). */
export function noiseSamples(color: NoiseColor, length: number, rand = Math.random): Float32Array<ArrayBuffer> {
  const out = new Float32Array(length);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let last = 0;
  for (let i = 0; i < length; i++) {
    const w = rand() * 2 - 1;
    if (color === 'white') {
      out[i] = w * 0.5;
    } else if (color === 'pink') {
      // Фільтр Пола Келлета
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      out[i] = last * 3.5;
    }
  }
  return out;
}

/**
 * Звуки для засинання на Web Audio, без зовнішніх файлів.
 * Дощ = рожевий шум у смузі «шелесту» + низький гул + окремі краплі.
 */
class SleepSounds {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private nodes: AudioScheduledSourceNode[] = [];
  private dropTimer: ReturnType<typeof setInterval> | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(s: SoundsState) => void>();
  private state: SoundsState = { playing: false, id: null, endsAt: null, volume: 0.6 };

  getState(): SoundsState {
    return this.state;
  }

  subscribe(fn: (s: SoundsState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  /** Викликати з обробника натискання. */
  play(id: SoundId, timerMin: number) {
    this.teardown();
    if (!this.ctx) this.ctx = new AudioContext();
    const ctx = this.ctx;
    void ctx.resume().catch(() => undefined);
    const master = ctx.createGain();
    master.connect(ctx.destination);
    this.master = master;

    const loop = (color: NoiseColor, seconds = 4) => {
      const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
      buf.copyToChannel(noiseSamples(color, buf.length), 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      this.nodes.push(src);
      return src;
    };

    if (id === 'rain') {
      const hiss = loop('pink');
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400;
      bp.Q.value = 0.4;
      const hissGain = ctx.createGain();
      hissGain.gain.value = 0.9;
      hiss.connect(bp).connect(hissGain).connect(master);
      const rumble = loop('brown');
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 400;
      const rumbleGain = ctx.createGain();
      rumbleGain.gain.value = 0.5;
      rumble.connect(lp).connect(rumbleGain).connect(master);
      const dropBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate);
      dropBuf.copyToChannel(noiseSamples('white', dropBuf.length), 0);
      this.dropTimer = setInterval(() => {
        const t = ctx.currentTime;
        for (let k = 0; k < 6; k++) {
          const src = ctx.createBufferSource();
          src.buffer = dropBuf;
          const f = ctx.createBiquadFilter();
          f.type = 'bandpass';
          f.frequency.value = 2500 + Math.random() * 4000;
          f.Q.value = 3;
          const g = ctx.createGain();
          const at = t + Math.random() * 0.25;
          g.gain.setValueAtTime(0.05 + Math.random() * 0.12, at);
          g.gain.exponentialRampToValueAtTime(0.0001, at + 0.035);
          src.connect(f).connect(g).connect(master);
          src.start(at);
        }
      }, 250);
    } else {
      loop(id).connect(master);
    }
    this.nodes.forEach((n) => n.start());

    const endsAt = Date.now() + timerMin * 60_000;
    this.state = { ...this.state, playing: true, id, endsAt };
    this.applyVolume();
    this.endTimer = setTimeout(() => this.stop(0), timerMin * 60_000 + 200);
    this.emit();
  }

  setVolume(volume: number) {
    this.state = { ...this.state, volume };
    this.applyVolume();
    this.emit();
  }

  /** Зупинка (за замовчуванням — коротке затухання). */
  stop(fadeSec = 1.5) {
    if (!this.state.playing) return;
    const { ctx, master, nodes } = this;
    if (ctx && master && fadeSec > 0) {
      // Відв'язуємо вузли від класу, щоб наступний play() не обірвав затухання.
      this.nodes = [];
      this.master = null;
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0, t + fadeSec);
      setTimeout(() => {
        nodes.forEach((n) => {
          try {
            n.stop();
          } catch {
            /* вже зупинено */
          }
        });
        master.disconnect();
      }, fadeSec * 1000 + 100);
    }
    this.teardown();
    this.state = { ...this.state, playing: false, id: null, endsAt: null };
    this.emit();
  }

  /** Гучність + згасання за FADE_SEC до кінця таймера. */
  private applyVolume() {
    const { ctx, master } = this;
    const { volume, endsAt } = this.state;
    if (!ctx || !master || !endsAt) return;
    const t = ctx.currentTime;
    const left = (endsAt - Date.now()) / 1000;
    const level = volume * volume; // квадрат — природніша шкала гучності
    master.gain.cancelScheduledValues(t);
    if (left > FADE_SEC) {
      master.gain.setValueAtTime(level, t);
      master.gain.setValueAtTime(level, t + left - FADE_SEC);
    } else {
      master.gain.setValueAtTime(level * Math.max(0, left / FADE_SEC), t);
    }
    master.gain.linearRampToValueAtTime(0, t + Math.max(0.05, left));
  }

  private teardown() {
    if (this.dropTimer) clearInterval(this.dropTimer);
    if (this.endTimer) clearTimeout(this.endTimer);
    this.dropTimer = null;
    this.endTimer = null;
    this.nodes.forEach((n) => {
      try {
        n.stop();
      } catch {
        /* вже зупинено */
      }
    });
    this.nodes = [];
    this.master?.disconnect();
    this.master = null;
  }

  private emit() {
    this.listeners.forEach((fn) => fn(this.state));
  }
}

export const sleepSounds = new SleepSounds();
