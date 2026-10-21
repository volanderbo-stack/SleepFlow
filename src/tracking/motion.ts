type PermissionFn = () => Promise<'granted' | 'denied'>;

/**
 * На iOS доступ до DeviceMotion потрібно просити з обробника натискання.
 * Викликайте синхронно в onClick, до будь-якого await.
 */
export function requestMotionPermission(): Promise<boolean> {
  const DME = (typeof window !== 'undefined' ? window.DeviceMotionEvent : undefined) as
    | (typeof DeviceMotionEvent & { requestPermission?: PermissionFn })
    | undefined;
  if (!DME) return Promise.resolve(false);
  if (typeof DME.requestPermission !== 'function') return Promise.resolve(true);
  return DME.requestPermission()
    .then((r) => r === 'granted')
    .catch(() => false);
}

/** Слухає акселерометр і віддає |Δприскорення| між сусідніми подіями. */
export class MotionTracker {
  private last: { x: number; y: number; z: number } | null = null;
  private onDelta: ((t: number, delta: number) => void) | null = null;
  /** Чи прийшла хоч одна подія з реальними даними. */
  receiving = false;

  start(onDelta: (t: number, delta: number) => void) {
    this.onDelta = onDelta;
    window.addEventListener('devicemotion', this.handle);
  }

  stop() {
    window.removeEventListener('devicemotion', this.handle);
    this.onDelta = null;
    this.last = null;
  }

  private handle = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    const cur = { x: a.x, y: a.y, z: a.z };
    if (this.last) {
      const d = Math.hypot(cur.x - this.last.x, cur.y - this.last.y, cur.z - this.last.z);
      this.receiving = true;
      this.onDelta?.(Date.now(), d);
    }
    this.last = cur;
  };
}
