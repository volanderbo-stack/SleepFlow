const CANDIDATE_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export const CLIP_MS = 10_000;

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return CANDIDATE_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

/**
 * Записує короткий (≤10 с) фрагмент під час хропіння — лише якщо користувач це дозволив.
 * Одночасно пишеться не більше одного фрагмента.
 */
export class ClipRecorder {
  private stream: MediaStream;
  private recording = false;

  constructor(stream: MediaStream) {
    this.stream = stream;
  }

  get supported(): boolean {
    return pickMime() !== undefined;
  }

  get busy(): boolean {
    return this.recording;
  }

  record(durationMs = CLIP_MS): Promise<{ blob: Blob; durationSec: number } | null> {
    const mimeType = pickMime();
    if (!mimeType || this.recording) return Promise.resolve(null);
    this.recording = true;
    return new Promise((resolve) => {
      const chunks: Blob[] = [];
      const started = Date.now();
      let rec: MediaRecorder;
      try {
        rec = new MediaRecorder(this.stream, { mimeType, audioBitsPerSecond: 24_000 });
      } catch {
        this.recording = false;
        resolve(null);
        return;
      }
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        this.recording = false;
        const blob = new Blob(chunks, { type: mimeType });
        resolve(blob.size ? { blob, durationSec: (Date.now() - started) / 1000 } : null);
      };
      rec.onerror = () => {
        this.recording = false;
        resolve(null);
      };
      rec.start();
      setTimeout(() => rec.state !== 'inactive' && rec.stop(), durationMs);
    });
  }
}
