import { useMemo, useRef, useState } from 'react';
import { AlarmPlayer } from '../alarm/audioRamp';
import { IDEAL_MIN_NIGHTS, idealBedtime } from '../analysis/idealBedtime';
import { fmtClock, fmtDuration } from '../app/format';
import { useApp } from '../app/store';
import { APP_VERSION } from '../app/version';
import { DownloadIcon, PlayIcon, ShieldIcon, SparkIcon, TrashIcon, UploadIcon } from '../components/Icons';
import { exportData, importData, ImportError } from '../db/exportImport';
import * as repo from '../db/repo';
import { ALARM_SOUNDS, type AlarmSoundId } from '../db/types';
import { uk } from '../i18n/uk';

const GOAL_MIN = 5 * 60;
const GOAL_MAX = 11 * 60;
/** Прев'ю мелодії будильника: 8 с, гучність наростає за 2 с. */
const preview = new AlarmPlayer();

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ProfileScreen() {
  const settings = useApp((s) => s.settings);
  const nights = useApp((s) => s.nights);
  const updateSettings = useApp((s) => s.updateSettings);
  const refresh = useApp((s) => s.refresh);
  const ask = useApp((s) => s.ask);
  const showToast = useApp((s) => s.showToast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const hasDemo = nights.some((n) => n.isDemo);
  const validNights = nights.filter((n) => n.totalSleepMin > 0).length;
  const ideal = useMemo(() => idealBedtime(nights, settings.sleepGoalMin), [nights, settings.sleepGoalMin]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      showToast(e instanceof ImportError ? e.message : uk.common.error);
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const onExport = () =>
    run(async () => {
      const file = await exportData();
      downloadJson(`sleepflow-${new Date().toISOString().slice(0, 10)}.json`, file);
      showToast(uk.profile.exported);
    });

  const onImportFile = (f: File | undefined) =>
    run(async () => {
      if (!f) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(await f.text());
      } catch {
        throw new ImportError('Не вдалося прочитати JSON.');
      }
      if (!(await ask(uk.profile.importConfirm))) return;
      const res = await importData(parsed);
      await refresh();
      showToast(uk.profile.imported(res.nights));
    });

  const onDeleteDemo = () =>
    run(async () => {
      if (!(await ask(uk.profile.deleteDemoConfirm, true))) return;
      const n = await repo.deleteDemo();
      await refresh();
      showToast(uk.profile.demoDeleted(n));
    });

  const onAddDemo = () =>
    run(async () => {
      await repo.seedDemo();
      await refresh();
      showToast(uk.profile.demoAdded);
    });

  const onDeleteAll = () =>
    run(async () => {
      if (!(await ask(uk.profile.deleteAllConfirm, true))) return;
      await repo.deleteAll();
      await repo.saveSettings({ onboardingDone: true });
      await refresh();
      showToast(uk.profile.allDeleted);
    });

  const setGoal = (delta: number) => {
    const next = Math.min(GOAL_MAX, Math.max(GOAL_MIN, settings.sleepGoalMin + delta));
    if (next !== settings.sleepGoalMin) updateSettings({ sleepGoalMin: next });
  };

  return (
    <div className="screen">
      <h1 className="screen__title">{uk.profile.title}</h1>

      <section className="card">
        <span className="label">{uk.profile.goal}</span>
        <div className="stepper">
          <button className="stepper__btn" onClick={() => setGoal(-15)} disabled={settings.sleepGoalMin <= GOAL_MIN} aria-label="Менше">
            −
          </button>
          <strong className="stepper__value">{fmtDuration(settings.sleepGoalMin)}</strong>
          <button className="stepper__btn" onClick={() => setGoal(15)} disabled={settings.sleepGoalMin >= GOAL_MAX} aria-label="Більше">
            +
          </button>
        </div>

        <div className="row-between">
          <span className="label">{uk.profile.defaultWindow}</span>
          <strong>{settings.defaultWakeWindow} хв</strong>
        </div>
        <input
          className="range"
          type="range"
          min={10}
          max={45}
          step={5}
          value={settings.defaultWakeWindow}
          onChange={(e) => updateSettings({ defaultWakeWindow: Number(e.target.value) })}
          aria-label={uk.profile.defaultWindow}
        />

        <label className="label" htmlFor="alarm-sound">
          {uk.profile.alarmSound}
        </label>
        <div className="row-gap">
          <select
            id="alarm-sound"
            className="select"
            value={settings.alarmSound}
            onChange={(e) => updateSettings({ alarmSound: e.target.value as AlarmSoundId })}
          >
            {ALARM_SOUNDS.map((s) => (
              <option key={s} value={s}>
                {uk.alarmSounds[s]}
              </option>
            ))}
          </select>
          <button className="btn btn--ghost icon-btn" onClick={() => preview.start(settings.alarmSound, 2, 8)} aria-label={uk.profile.preview}>
            <PlayIcon size={18} />
          </button>
        </div>

        <div className="row-between top-gap">
          <label htmlFor="save-clips">{uk.profile.saveClips}</label>
          <label className="switch">
            <input id="save-clips" type="checkbox" checked={settings.saveSnoreClips} onChange={(e) => updateSettings({ saveSnoreClips: e.target.checked })} />
            <span />
          </label>
        </div>
        <p className="hint">{uk.profile.saveClipsHint}</p>
      </section>

      <section className="card card--soft">
        <h2 className="card__title">
          <SparkIcon size={18} className="accent" /> {uk.profile.idealBedtime}
        </h2>
        {ideal ? (
          <>
            <strong className="ideal__time">{fmtClock(ideal.bedtimeClock)}</strong>
            <p className="hint">{uk.profile.idealBest(fmtClock(ideal.bedtimeClock), ideal.avgScore, ideal.support)}</p>
            <p className="hint">{uk.profile.idealGoal(fmtDuration(settings.sleepGoalMin), fmtClock(ideal.wakeClock), fmtClock(ideal.latestForGoal))}</p>
            {ideal.usesDemo && <p className="hint dim">{uk.profile.idealDemo}</p>}
          </>
        ) : (
          <>
            <p className="hint">{uk.profile.idealLeft(Math.max(1, IDEAL_MIN_NIGHTS - validNights))}</p>
            <div className="progress" aria-hidden="true">
              <i style={{ width: `${Math.min(100, (validNights / IDEAL_MIN_NIGHTS) * 100)}%` }} />
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2 className="card__title">{uk.profile.data}</h2>
        <div className="stack">
          <button className="btn btn--ghost btn--block" onClick={onExport} disabled={busy}>
            <DownloadIcon size={18} /> {uk.profile.export}
          </button>
          <button className="btn btn--ghost btn--block" onClick={() => fileRef.current?.click()} disabled={busy}>
            <UploadIcon size={18} /> {uk.profile.import}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              onImportFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {hasDemo ? (
            <button className="btn btn--ghost btn--block" onClick={onDeleteDemo} disabled={busy}>
              {uk.profile.deleteDemo}
            </button>
          ) : (
            <button className="btn btn--ghost btn--block" onClick={onAddDemo} disabled={busy}>
              {uk.profile.addDemo}
            </button>
          )}
          <button className="btn btn--danger-ghost btn--block" onClick={onDeleteAll} disabled={busy}>
            <TrashIcon size={18} /> {uk.profile.deleteAll}
          </button>
        </div>
      </section>

      <section className="card card--soft">
        <p className="row-gap">
          <ShieldIcon size={20} className="accent" />
          <span className="hint">{uk.profile.privacy}</span>
        </p>
        <p className="hint">{uk.profile.disclaimer}</p>
        <p className="hint dim">{uk.profile.version(APP_VERSION)}</p>
      </section>
    </div>
  );
}
