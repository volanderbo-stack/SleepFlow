import workletUrl from './frameWorklet.ts?worker&url';
import type { FromWorklet, ToWorklet } from './pipeline';

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
 * Мікрофон → AudioWorklet з усім аналізом. Звук не записується —
 * назад приходять лише ознаки кадрів, готові епохи й події (хропіння, дедлайн будильника).
 */
export class WorkletTracker {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;

  async start(stream: MediaStream, onMessage: (m: FromWorklet) => void) {
    const ctx = new AudioContext();
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(workletUrl);
    this.source = ctx.createMediaStreamSource(stream);
    this.node = new AudioWorkletNode(ctx, 'sleep-frame-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    this.node.port.onmessage = (e: MessageEvent<FromWorklet>) => onMessage(e.data);
    // Вихід з нульовою гучністю в динамік — щоб браузер гарантовано «тягнув» граф і викликав process().
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.node).connect(this.sink).connect(ctx.destination);
    await ctx.resume().catch(() => undefined);
  }

  post(m: ToWorklet) {
    this.node?.port.postMessage(m);
  }

  /** AudioContext міг призупинитися (дзвінок, інший застосунок) — відновлюємо. */
  async resume() {
    if (this.ctx?.state === 'suspended') await this.ctx.resume().catch(() => undefined);
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  async stop() {
    this.source?.disconnect();
    this.node?.disconnect();
    if (this.node) this.node.port.onmessage = null;
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.source = null;
    this.node = null;
    this.sink = null;
  }
}
