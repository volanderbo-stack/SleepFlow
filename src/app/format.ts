import { nightDate, noonMinutesToClock } from '../analysis/time';

const timeFmt = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' });
const longDayFmt = new Intl.DateTimeFormat('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });

export const fmtTime = (ts: number) => timeFmt.format(ts);

export const fmtNightDay = (startedAt: number) => dayFmt.format(nightDate(startedAt));
export const fmtNightDayLong = (startedAt: number) => longDayFmt.format(nightDate(startedAt));

/** 452 → «7 год 32 хв» */
export function fmtDuration(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} хв`;
  return r ? `${h} год ${r} хв` : `${h} год`;
}

/** 452 → «7:32» */
export function fmtHM(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Хвилини від півночі → «23:05». */
export function fmtClock(minutesFromMidnight: number): string {
  const m = ((Math.round(minutesFromMidnight) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Хвилини від полудня (як у статистиці лягання/підйому) → «23:05». */
export const fmtNoonClock = (m: number) => fmtClock(noonMinutesToClock(m));

/** Колір оцінки: від червоного до бірюзового. */
export function scoreColor(score: number): string {
  if (score >= 85) return 'var(--good)';
  if (score >= 70) return 'var(--ok)';
  if (score >= 55) return 'var(--warn)';
  return 'var(--bad)';
}
