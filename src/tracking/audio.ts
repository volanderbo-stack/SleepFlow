import { computeFrame, type AudioFrame } from './audioFeatures';

export class MicUnavailableError extends Error {}

/** Відкриває мікрофон без обробки (без шумозаглушення й АРУ — інакше тиша «підтягується»). */
export function openMicrophone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new MicUnavailableError(window.isSecureContext ? 'no-api' : 'insecure'));
  }
  return navigator.mediaDevices
    .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    .catch((e: unknown) => {
      throw new MicUnavailableError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'denied' : 'failed');
    });
}

/**
 * Аналізує потік мікрофона кадрами по ~100 мс. Звук не записується —
 * назовні йдуть лише рівень і частки спектра.
 */
export class AudioAnalyzer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private timeData = new Float32Array(2048);
  private spectrum = new Float32Array(1024);

  /** Викликати після дії користувача (вимога автозапуску аудіо). */
  start(stream: MediaStream) {
    this.ctx = new AudioContext();
    this.source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;
    this.timeData = new Float32Array(this.analyser.fftSize);
    this.spectrum = new Float32Array(this.analyser.frequencyBinCount);
    this.source.connect(this.analyser);
  }

  /** AudioContext міг призупинитися (згортання, дзвінок) — відновлюємо. */
  async resume() {
    if (this.ctx?.state === 'suspended') await this.ctx.resume().catch(() => undefined);
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  read(t: number): AudioFrame | null {
    if (!this.analyser || !this.ctx) return null;
    this.analyser.getFloatTimeDomainData(this.timeData);
    this.analyser.getFloatFrequencyData(this.spectrum);
    return computeFrame(t, this.timeData, this.spectrum, this.ctx.sampleRate / this.analyser.fftSize);
  }

  async stop() {
    this.source?.disconnect();
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.analyser = null;
    this.source = null;
  }
}
