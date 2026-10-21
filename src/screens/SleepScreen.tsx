import { useMemo, useState } from 'react';
import { sleepDebt } from '../analysis/debt';
import { idealBedtime } from '../analysis/idealBedtime';
import { fmtClock, fmtDuration, fmtTime } from '../app/format';
import { SoundsSheet, minutesLeft, useSounds } from '../components/SoundsSheet';
import { useNow } from '../app/hooks';
import { nextAlarmTs, useApp } from '../app/store';
import { BellIcon, MoonIcon, WavesIcon } from '../components/Icons';
import { TagPicker } from '../components/TagPicker';
import { uk } from '../i18n/uk';

function greeting(h: number) {
  if (h < 5 || h >= 22) return uk.greeting.night;
  if (h < 12) return uk.greeting.morning;
  if (h < 18) return uk.greeting.day;
  return uk.greeting.evening;
}

export function SleepScreen() {
  const now = useNow();
  const tonight = useApp((s) => s.tonight);
  const setTonight = useApp((s) => s.setTonight);
  const sounds = useSounds();
  const [soundsOpen, setSoundsOpen] = useState(false);
  const startSleep = useApp((s) => s.startSleep);
  const starting = useApp((s) => s.tracking.phase === 'starting');

  const nights = useApp((s) => s.nights);
  const goal = useApp((s) => s.settings.sleepGoalMin);
  const debt = useMemo(() => sleepDebt(nights, goal, now), [nights, goal, now]);
  const ideal = useMemo(() => idealBedtime(nights, goal), [nights, goal]);

  const alarmTs = nextAlarmTs(tonight.alarmTime, now);
  const windowStart = alarmTs - tonight.wakeWindow * 60_000;

  return (
    <div className="screen screen--sleep">
      <header className="sleep-head">
        <p className="muted">{greeting(new Date(now).getHours())}</p>
        <h1 className="clock">{fmtTime(now)}</h1>
      </header>

      <div className="start-wrap">
        <button className="start-btn" onClick={startSleep} disabled={starting}>
          <MoonIcon size={40} />
          <span>{starting ? uk.night.starting : uk.sleep.start}</span>
        </button>
        <p className="hint center">{uk.night.prepHint}</p>
        {tonight.alarmOn && <p className="muted center">{uk.sleep.sleepFor(fmtDuration((alarmTs - now) / 60_000))}</p>}
        <div className="pills">
          <a href="#/stats" className={`pill${debt.debtMin >= 60 ? ' pill--warn' : ''}`}>
            {debt.debtMin > 0 ? `${uk.stats.debt}: ${fmtDuration(debt.debtMin)}` : uk.stats.debtNone}
          </a>
          {ideal && (
            <a href="#/profile" className="pill">
              {uk.profile.idealShort(fmtClock(ideal.bedtimeClock))}
            </a>
          )}
        </div>
      </div>

      <section className="card">
        <div className="row-between">
          <label className="card__title" htmlFor="alarm-on">
            <BellIcon size={18} /> {uk.sleep.alarm}
          </label>
          <label className="switch">
            <input id="alarm-on" type="checkbox" checked={tonight.alarmOn} onChange={(e) => setTonight({ alarmOn: e.target.checked })} />
            <span />
          </label>
        </div>
        {tonight.alarmOn ? (
          <>
            <input
              className="time-input"
              type="time"
              value={tonight.alarmTime}
              onChange={(e) => e.target.value && setTonight({ alarmTime: e.target.value })}
              aria-label={uk.sleep.alarm}
            />
            <div className="row-between">
              <span className="label">{uk.sleep.wakeWindow}</span>
              <strong>{tonight.wakeWindow} хв</strong>
            </div>
            <input
              className="range"
              type="range"
              min={10}
              max={45}
              step={5}
              value={tonight.wakeWindow}
              onChange={(e) => setTonight({ wakeWindow: Number(e.target.value) })}
              aria-label={uk.sleep.wakeWindow}
            />
            <p className="hint">{uk.sleep.wakeWindowHint(fmtTime(windowStart), fmtTime(alarmTs))}</p>
          </>
        ) : (
          <p className="hint">{uk.sleep.noAlarm}</p>
        )}
      </section>

      <section className="card">
        <h2 className="card__title">{uk.sleep.tonight}</h2>
        <p className="hint">{uk.sleep.tonightHint}</p>
        <TagPicker value={tonight.tags} onChange={(tags) => setTonight({ tags })} />
      </section>

      <button className={`btn btn--ghost btn--block${sounds.playing ? ' is-active' : ''}`} onClick={() => setSoundsOpen(true)}>
        <WavesIcon size={20} /> {sounds.playing && sounds.id ? uk.night.sounds(uk.sounds.names[sounds.id], minutesLeft(sounds, now)) : uk.sleep.sounds}
      </button>
      {soundsOpen && <SoundsSheet onClose={() => setSoundsOpen(false)} />}
    </div>
  );
}
