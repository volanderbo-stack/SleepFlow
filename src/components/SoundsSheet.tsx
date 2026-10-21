import { useEffect, useState } from 'react';
import { useNow } from '../app/hooks';
import { uk } from '../i18n/uk';
import { SOUND_IDS, TIMER_OPTIONS, sleepSounds, type SoundId, type SoundsState } from '../sounds/sleepSounds';

export function useSounds(): SoundsState {
  const [s, setS] = useState(sleepSounds.getState());
  useEffect(() => sleepSounds.subscribe(setS), []);
  return s;
}

/** `now` з useNow лише змушує перерендер; рахуємо від справжнього поточного часу. */
export const minutesLeft = (s: SoundsState, now: number) =>
  s.endsAt ? Math.max(0, Math.ceil((s.endsAt - Math.max(now, Date.now())) / 60_000)) : 0;

export function SoundsSheet({ onClose }: { onClose: () => void }) {
  const state = useSounds();
  const now = useNow(5_000);
  const [id, setId] = useState<SoundId>(state.id ?? 'rain');
  const [timer, setTimer] = useState<number>(30);

  const choose = (next: SoundId) => {
    setId(next);
    if (state.playing) sleepSounds.play(next, timer);
  };
  const chooseTimer = (min: number) => {
    setTimer(min);
    if (state.playing) sleepSounds.play(id, min);
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog sheet" role="dialog" aria-modal="true" aria-label={uk.sounds.title} onClick={(e) => e.stopPropagation()}>
        <h2 className="card__title">{uk.sounds.title}</h2>
        <div className="sound-grid">
          {SOUND_IDS.map((s) => (
            <button key={s} className={`sound-tile${id === s ? ' is-on' : ''}${state.playing && state.id === s ? ' is-playing' : ''}`} onClick={() => choose(s)} aria-pressed={id === s}>
              <span className="sound-tile__emoji" aria-hidden="true">
                {uk.sounds.emoji[s]}
              </span>
              {uk.sounds.names[s]}
            </button>
          ))}
        </div>

        <span className="label">{uk.sounds.timer}</span>
        <div className="chips">
          {TIMER_OPTIONS.map((m) => (
            <button key={m} className={`chip${timer === m ? ' chip--on' : ''}`} aria-pressed={timer === m} onClick={() => chooseTimer(m)}>
              {m} хв
            </button>
          ))}
        </div>

        <div className="row-between">
          <span className="label">{uk.sounds.volume}</span>
          <strong>{Math.round(state.volume * 100)}%</strong>
        </div>
        <input
          className="range"
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={state.volume}
          onChange={(e) => sleepSounds.setVolume(Number(e.target.value))}
          aria-label={uk.sounds.volume}
        />

        {state.playing && <p className="hint">{uk.sounds.left(minutesLeft(state, now))}</p>}
        <p className="hint">{uk.sounds.micNote}</p>

        <div className="dialog__actions">
          {state.playing ? (
            <button className="btn btn--ghost" onClick={() => sleepSounds.stop()}>
              {uk.sounds.stop}
            </button>
          ) : (
            <button className="btn btn--primary" onClick={() => sleepSounds.play(id, timer)}>
              {uk.sounds.play}
            </button>
          )}
          <button className="btn btn--ghost" onClick={onClose}>
            {uk.sounds.close}
          </button>
        </div>
      </div>
    </div>
  );
}
