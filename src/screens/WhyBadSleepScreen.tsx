import { useMemo } from 'react';
import { badThreshold, factorEffects, MIN_GROUP, type FactorEffect } from '../analysis/correlations';
import { navigate } from '../app/router';
import { useApp } from '../app/store';
import { BackIcon } from '../components/Icons';
import { uk } from '../i18n/uk';

/** Ефект менше цього (у %) вважаємо «майже не впливає». */
const NEUTRAL_PCT = 3;
/** Шкала смужки: ±25% займає всю половину. */
const BAR_SCALE = 25;

const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0');

function FactorCard({ e }: { e: FactorEffect }) {
  const name = uk.factors.names[e.id];
  const width = Math.min(50, (Math.abs(e.diffPct) / BAR_SCALE) * 50);
  const details = [
    e.onsetDiffMin !== 0 && uk.why.onset(signed(e.onsetDiffMin)),
    e.deepDiffPp !== 0 && uk.why.deep(signed(e.deepDiffPp)),
    Math.abs(e.awakeningsDiff) >= 0.3 && uk.why.awakenings(signed(e.awakeningsDiff)),
    Math.abs(e.sleepDiffMin) >= 10 && uk.why.sleep(signed(e.sleepDiffMin)),
    e.diffPct < 0 && e.inBad > 0 && uk.why.badShare(e.inBad, e.badTotal),
  ].filter(Boolean) as string[];

  return (
    <li className="factor">
      <div className="factor__head">
        <span className="factor__emoji" aria-hidden="true">
          {uk.factors.emoji[e.id]}
        </span>
        <strong>{name}</strong>
        <span className={`factor__pct ${e.diffPct < 0 ? 'is-bad' : 'is-good'}`}>
          {e.diffPct > 0 ? '+' : e.diffPct < 0 ? '−' : ''}
          {Math.abs(e.diffPct)}%
        </span>
      </div>
      <div className="factor__bar" aria-hidden="true">
        <i
          className={e.diffPct < 0 ? 'is-bad' : 'is-good'}
          style={e.diffPct < 0 ? { right: '50%', width: `${width}%` } : { left: '50%', width: `${width}%` }}
        />
      </div>
      <p className="factor__line">{uk.why.line(name, e.diffPct, e.withN)}</p>
      <p className="hint">
        {uk.why.scoreWith}: {e.avgWith} · {uk.why.scoreWithout}: {e.avgWithout}
      </p>
      {details.length > 0 && (
        <div className="chips chips--small">
          {details.map((d) => (
            <span key={d} className="chip chip--static">
              {d}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

function Group({ title, items }: { title: string; items: FactorEffect[] }) {
  if (!items.length) return null;
  return (
    <section className="stack">
      <h2 className="section-title">{title}</h2>
      <ul className="factor-list">
        {items.map((e) => (
          <FactorCard key={e.id} e={e} />
        ))}
      </ul>
    </section>
  );
}

export function WhyBadSleepScreen() {
  const nights = useApp((s) => s.nights);
  const { effects, threshold, badCount, total } = useMemo(() => {
    const valid = nights.filter((n) => n.totalSleepMin > 0);
    const t = badThreshold(valid);
    return { effects: factorEffects(valid), threshold: t, badCount: valid.filter((n) => n.score <= t).length, total: valid.length };
  }, [nights]);

  const hurts = effects.filter((e) => e.diffPct <= -NEUTRAL_PCT);
  const helps = effects.filter((e) => e.diffPct >= NEUTRAL_PCT);
  const neutral = effects.filter((e) => Math.abs(e.diffPct) < NEUTRAL_PCT);

  return (
    <div className="screen">
      <button className="back" onClick={() => navigate('/stats')}>
        <BackIcon size={20} /> {uk.journal.back}
      </button>
      <h1 className="screen__title">{uk.why.title}</h1>

      {effects.length === 0 ? (
        <p className="empty">{uk.why.empty(MIN_GROUP)}</p>
      ) : (
        <>
          <p className="muted">{uk.why.intro(badCount, total, threshold)}</p>
          <Group title={uk.why.hurts} items={hurts} />
          <Group title={uk.why.helps} items={helps} />
          <Group title={uk.why.neutral} items={neutral} />
          <p className="hint center">{uk.why.disclaimer}</p>
        </>
      )}
    </div>
  );
}
