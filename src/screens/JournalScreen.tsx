import { fmtDuration, fmtNightDay, fmtTime } from '../app/format';
import { useApp } from '../app/store';
import { MiniHypnogram } from '../components/Hypnogram';
import { ChevronIcon } from '../components/Icons';
import { ScoreRing } from '../components/ScoreRing';
import { uk } from '../i18n/uk';

export function JournalScreen() {
  const nights = useApp((s) => s.nights);

  return (
    <div className="screen">
      <h1 className="screen__title">{uk.journal.title}</h1>
      {nights.length === 0 ? (
        <p className="empty">{uk.journal.empty}</p>
      ) : (
        <ul className="night-list">
          {nights.map((n, i) => (
            <li key={n.id} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
              <a className="night-row" href={`#/journal/${n.id}`}>
                <ScoreRing score={n.score} size={48} stroke={5} />
                <div className="night-row__main">
                  <div className="night-row__date">
                    {fmtNightDay(n.startedAt)}
                    {n.isDemo && <span className="badge">{uk.journal.demo}</span>}
                  </div>
                  <div className="muted small">
                    {fmtTime(n.startedAt)} – {fmtTime(n.endedAt)} · {fmtDuration(n.totalSleepMin)}
                  </div>
                </div>
                <MiniHypnogram stages={n.stages} startedAt={n.startedAt} endedAt={n.endedAt} />
                <ChevronIcon size={18} className="dim" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
