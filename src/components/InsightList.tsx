import type { Insight } from '../analysis/insights';
import { fmtDuration } from '../app/format';
import { uk } from '../i18n/uk';

const ICON: Record<Insight['tone'], string> = { warn: '⚠️', good: '✅', info: '💡' };

export function insightText(i: Insight): string {
  const t = uk.insight;
  switch (i.kind) {
    case 'debt':
      return t.debt(fmtDuration(i.debtMin), i.earlierMin);
    case 'no_debt':
      return t.no_debt;
    case 'irregular':
      return t.irregular(i.sdMin);
    case 'regular':
      return t.regular(i.sdMin);
    case 'factor_bad':
      return t.factor_bad(uk.factors.names[i.factor], i.pct);
    case 'factor_good':
      return t.factor_good(uk.factors.names[i.factor], i.pct);
    case 'trend_up':
      return t.trend_up(i.points);
    case 'trend_down':
      return t.trend_down(i.points);
    case 'slow_onset':
      return t.slow_onset(i.min);
    case 'snore':
      return t.snore(i.min);
    case 'low_deep':
      return t.low_deep(i.pct);
    case 'avg_sleep':
      return t.avg_sleep(fmtDuration(i.min), fmtDuration(i.goalMin));
  }
}

export function InsightList({ items }: { items: Insight[] }) {
  return (
    <ul className="insights">
      {items.map((i) => (
        <li key={i.kind} className={`insight insight--${i.tone}`}>
          <span aria-hidden="true">{ICON[i.tone]}</span>
          <span>{insightText(i)}</span>
        </li>
      ))}
    </ul>
  );
}
