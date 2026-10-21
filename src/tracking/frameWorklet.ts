/// <reference lib="es2022" />
// AudioWorklet: виконується в аудіопотоці браузера. На Android він продовжує працювати з вимкненим
// екраном, поки відкритий мікрофон, — на відміну від таймерів основного потоку, які Chrome «заморожує».
import { TrackingPipeline, type ToWorklet } from './pipeline';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class SleepFrameProcessor extends AudioWorkletProcessor {
  private pipeline = new TrackingPipeline(sampleRate);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => this.send(this.pipeline.handle(e.data));
  }

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (ch) this.send(this.pipeline.process(ch, Date.now()));
    return true;
  }

  private send(msgs: unknown[]) {
    for (const m of msgs) this.port.postMessage(m);
  }
}

registerProcessor('sleep-frame-processor', SleepFrameProcessor);
