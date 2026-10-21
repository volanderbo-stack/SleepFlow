const DAY_MIN = 24 * 60;

/**
 * Час лягання як хвилини від полудня (0..1439), щоб 23:30 і 00:30 були поруч
 * (690 і 750), а не на різних кінцях доби.
 */
export function minutesFromNoon(ts: number): number {
  const d = new Date(ts);
  const m = d.getHours() * 60 + d.getMinutes();
  return (m - 12 * 60 + DAY_MIN) % DAY_MIN;
}

/** Зворотне перетворення: хвилини від полудня → хвилини від півночі (0..1439). */
export function noonMinutesToClock(m: number): number {
  return (Math.round(m) + 12 * 60) % DAY_MIN;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Ніч належить даті вечора, коли лягли (до 06:00 — це ще попередній вечір). */
export function nightDate(startedAt: number): Date {
  const d = new Date(startedAt);
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function stdDev(values: number[]): number | null {
  const m = mean(values);
  if (m === null || values.length < 2) return null;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

export const DAY_MS = 24 * 60 * 60_000;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
