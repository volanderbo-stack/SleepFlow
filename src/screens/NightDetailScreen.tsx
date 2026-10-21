import { useEffect, useMemo, useState } from 'react';
import { fmtDuration, fmtNightDayLong, fmtTime } from '../app/format';
import { navigate } from '../app/router';
import { useApp } from '../app/store';
import { Hypnogram } from '../components/Hypnogram';
import { BackIcon, TrashIcon } from '../components/Icons';
import { NoiseChart } from '../components/NoiseChart';
import { ScoreRing } from '../components/ScoreRing';
import { TagPicker } from '../components/TagPicker';
import * as repo from '../db/repo';
import type { Night, SnoreClip, Stage, TagId } from '../db/types';
import { uk } from '../i18n/uk';

function stageShares(n: Night): Record<Stage, number> {
  const ms: Record<Stage, number> = { awake: 0, light: 0, deep: 0 };
  for (const s of n.stages) ms[s.stage] += s.to - s.from;
  const total = ms.awake + ms.light + ms.deep || 1;
  return { awake: (ms.awake / total) * 100, light: (ms.light / total) * 100, deep: (ms.deep / total) * 100 };
}

function SnoreClips({ nightId }: { nightId: number }) {
  const [clips, setClips] = useState<(SnoreClip & { url: string })[]>([]);
  useEffect(() => {
    let urls: string[] = [];
    repo.listClips(nightId).then((list) => {
      const withUrls = list.map((c) => ({ ...c, url: URL.createObjectURL(c.blob) }));
      urls = withUrls.map((c) => c.url);
      setClips(withUrls);
    });
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [nightId]);

  if (clips.length === 0) return <p className="hint">{uk.journal.noClips}</p>;
  return (
    <ul className="clips">
      {clips.map((c) => (
        <li key={c.id}>
          <span className="muted small">
            {fmtTime(c.t)} · {Math.round(c.durationSec)} с
          </span>
          <audio controls preload="none" src={c.url} />
        </li>
      ))}
    </ul>
  );
}

export function NightDetailScreen({ id }: { id: number }) {
  const night = useApp((s) => s.nights.find((n) => n.id === id));
  const refresh = useApp((s) => s.refresh);
  const ask = useApp((s) => s.ask);
  const showToast = useApp((s) => s.showToast);
  const [note, setNote] = useState(night?.note ?? '');

  useEffect(() => setNote(night?.note ?? ''), [night?.id, night?.note]);
  const shares = useMemo(() => (night ? stageShares(night) : null), [night]);

  if (!night || !shares) {
    return (
      <div className="screen">
        <button className="back" onClick={() => navigate('/journal')}>
          <BackIcon size={20} /> {uk.journal.back}
        </button>
        <p className="empty">{uk.journal.notFound}</p>
      </div>
    );
  }

  const saveTags = async (tags: TagId[]) => {
    await repo.updateNight(id, { tags });
    await refresh();
  };
  const saveNote = async () => {
    if (note === night.note) return;
    await repo.updateNight(id, { note });
    await refresh();
  };
  const remove = async () => {
    if (!(await ask(uk.journal.deleteConfirm, true))) return;
    await repo.deleteNight(id);
    navigate('/journal');
    await refresh();
    showToast(uk.journal.deleted);
  };

  // «Розумне» пробудження — лише всередині вікна; ручна зупинка раніше не рахується.
  const smartWakeMin =
    night.alarmTarget &&
    night.actualWakeAt &&
    night.actualWakeAt < night.alarmTarget &&
    night.actualWakeAt >= night.alarmTarget - night.wakeWindowMin * 60_000
      ? Math.round((night.alarmTarget - night.actualWakeAt) / 60_000)
      : 0;

  const metrics: [string, string][] = [
    [uk.journal.duration, fmtDuration(night.totalSleepMin)],
    [uk.journal.onset, `${night.sleepOnsetMin} хв`],
    [uk.journal.deep, `${night.deepPct}%`],
    [uk.journal.awakenings, String(night.awakenings)],
    [uk.journal.snore, `${night.snoreMin} хв`],
    [`${uk.journal.bed} / ${uk.journal.wake}`, `${fmtTime(night.startedAt)} – ${fmtTime(night.endedAt)}`],
  ];

  return (
    <div className="screen">
      <button className="back" onClick={() => navigate('/journal')}>
        <BackIcon size={20} /> {uk.journal.back}
      </button>

      <header className="detail-head">
        <ScoreRing score={night.score} size={128} stroke={11} label="зі 100" />
        <div>
          <h1 className="detail-head__date">{fmtNightDayLong(night.startedAt)}</h1>
          {night.isDemo && <span className="badge">{uk.journal.demo}</span>}
          {smartWakeMin > 0 && <p className="hint">{uk.journal.smartWake(smartWakeMin)}</p>}
        </div>
      </header>

      <div className="metrics">
        {metrics.map(([label, value]) => (
          <div key={label} className="metric">
            <span className="metric__value">{value}</span>
            <span className="metric__label">{label}</span>
          </div>
        ))}
      </div>

      <section className="card">
        <h2 className="card__title">{uk.journal.hypnogram}</h2>
        <Hypnogram stages={night.stages} startedAt={night.startedAt} endedAt={night.endedAt} gaps={night.gaps} />
        <div className="stage-bar" aria-hidden="true">
          {(['deep', 'light', 'awake'] as Stage[]).map((s) => (
            <i key={s} className={`stage-bar__${s}`} style={{ width: `${shares[s]}%` }} />
          ))}
        </div>
        <div className="legend">
          {(['deep', 'light', 'awake'] as Stage[]).map((s) => (
            <span key={s}>
              <i className={`dot--${s}`} />
              {uk.stage[s]} {Math.round(shares[s])}%
            </span>
          ))}
        </div>
        {night.gaps && night.gaps.length > 0 && <p className="hint warn">{uk.journal.gaps(night.gaps.length)}</p>}
      </section>

      <section className="card">
        <h2 className="card__title">{uk.journal.noise}</h2>
        <NoiseChart epochs={night.epochs} />
      </section>

      <section className="card">
        <h2 className="card__title">{uk.journal.clips}</h2>
        <SnoreClips nightId={id} />
      </section>

      <section className="card">
        <h2 className="card__title">{uk.journal.tags}</h2>
        <TagPicker value={night.tags} onChange={saveTags} />
        <label className="label" htmlFor="note">
          {uk.journal.note}
        </label>
        <textarea id="note" className="textarea" rows={3} value={note} placeholder={uk.journal.notePlaceholder} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} />
      </section>

      <button className="btn btn--danger-ghost btn--block" onClick={remove}>
        <TrashIcon size={18} /> {uk.journal.delete}
      </button>
    </div>
  );
}
