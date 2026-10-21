export type WakeLockState = 'on' | 'off' | 'unsupported';

/** Тримає екран увімкненим і повторно бере блокування, коли вкладка знову видима. */
export class WakeLockKeeper {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;
  private listener: ((s: WakeLockState) => void) | null = null;

  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  get state(): WakeLockState {
    if (!this.supported) return 'unsupported';
    return this.sentinel && !this.sentinel.released ? 'on' : 'off';
  }

  onChange(fn: (s: WakeLockState) => void) {
    this.listener = fn;
  }

  async acquire(): Promise<WakeLockState> {
    this.wanted = true;
    if (!this.supported) return this.emit();
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => this.emit());
      document.addEventListener('visibilitychange', this.onVisibility);
    } catch {
      this.sentinel = null;
    }
    return this.emit();
  }

  async release() {
    this.wanted = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    try {
      await this.sentinel?.release();
    } catch {
      /* вже відпущено */
    }
    this.sentinel = null;
    this.emit();
  }

  private onVisibility = () => {
    if (this.wanted && document.visibilityState === 'visible' && this.state !== 'on') void this.acquire();
  };

  private emit(): WakeLockState {
    const s = this.state;
    this.listener?.(s);
    return s;
  }
}
