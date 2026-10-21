import { useEffect, useRef, useState } from 'react';
import { fmtTime } from '../app/format';
import { isDebug, useNow } from '../app/hooks';
import { useApp } from '../app/store';
import { DebugPanel } from '../components/DebugPanel';
import { minutesLeft, useSounds } from '../components/SoundsSheet';
import { uk } from '../i18n/uk';
import { SNOOZE_MIN, session } from '../tracking/session';

const HOLD_MS = 1500;
const BRIGHT_MS = 10_000;

/** Тримання кнопки замість дотику — щоб не завершити ніч випадково уві сні. */
function HoldButton({ onDone, disabled, label }: { onDone: () => void; disabled: boolean; label: string }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const begin = () => {
    if (disabled) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      setHolding(false);
      onDone();
    }, HOLD_MS);
  };
  useEffect(() => cancel, []);
  return (
    <button
      className={`hold-btn${holding ? ' is-holding' : ''}`}
      style={{ ['--hold' as string]: `${HOLD_MS}ms` }}
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !holding && begin()}
      onKeyUp={cancel}
      disabled={disabled}
    >
      <span className="hold-btn__fill" />
      <span className="hold-btn__label">{disabled ? uk.night.stopping : label}</span>
    </button>
  );
}

/** Екран дзвінка: велика дата/час, «Відкласти» і «Вимкнути» — звичайні кнопки, людина вже прокинулась. */
function RingScreen() {
  const t = useApp((s) => s.tracking);
  const stopSleep = useApp((s) => s.stopSleep);
  const snooze = useApp((s) => s.snooze);
  const now = useNow(1000);
  return (
    <div className="ring" role="alertdialog" aria-label={uk.ring.morning}>
      <div className="ring__sun" aria-hidden="true" />
      <div className="ring__clock">{fmtTime(now)}</div>
      <h1 className="ring__title">{uk.ring.morning}</h1>
      {t.wakeReason && <p className="ring__reason">{uk.ring.reason[t.wakeReason]}</p>}
      <div className="ring__actions">
        <button className="btn btn--ghost btn--block ring__snooze" onClick={snooze}>
          {uk.ring.snooze(SNOOZE_MIN)}
        </button>
        <button className="btn btn--primary btn--block ring__dismiss" onClick={() => void stopSleep()} disabled={t.phase !== 'running'}>
          {t.phase === 'stopping' ? uk.night.stopping : uk.ring.dismiss}
        </button>
      </div>
    </div>
  );
}

function DebugAlarmControls() {
  return (
    <div className="debug-actions">
      <button className="btn btn--ghost" onClick={() => session.debugSetAlarm(30_000, 0)}>
        {uk.night.debugAlarm30}
      </button>
      <button className="btn btn--ghost" onClick={() => session.debugSetAlarm(2 * 60_000, 2)}>
        {uk.night.debugAlarm2m}
      </button>
      <button className="btn btn--ghost" onClick={() => session.debugRingNow()}>
        {uk.night.debugRing}
      </button>
    </div>
  );
}

export function NightModeScreen() {
  const t = useApp((s) => s.tracking);
  const stopSleep = useApp((s) => s.stopSleep);
  const sounds = useSounds();
  const now = useNow(1000);
  const [brightUntil, setBrightUntil] = useState(() => Date.now() + BRIGHT_MS * 2);
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const debug = isDebug();
  const bright = debug || now < brightUntil;

  // Зсуваємо годинник щохвилини, щоб не «випалити» екран за ніч.
  useEffect(() => {
    const id = setInterval(() => setShift({ x: Math.round(Math.random() * 24 - 12), y: Math.round(Math.random() * 40 - 20) }), 60_000);
    return () => clearInterval(id);
  }, []);

  if (t.ringing) return <RingScreen />;

  const warnings: string[] = [];
  if (t.wakeLock === 'unsupported') warnings.push(uk.night.wakeLockUnsupported);
  else if (t.wakeLock === 'off' && t.phase === 'running') warnings.push(uk.night.wakeLockLost);
  if (t.charging === false) warnings.push(uk.night.notCharging);

  const micActivity = Math.min(1, Math.max(0, (t.level - t.baseline) / 20));
  const windowFrom = t.alarmTarget ? t.alarmTarget - t.wakeWindowMin * 60_000 : 0;
  const snoozed = t.snoozeUntil !== null;

  return (
    <div className={`night${bright ? ' is-bright' : ''}`} onPointerDown={() => setBrightUntil(Date.now() + BRIGHT_MS)}>
      <div className="night__status">
        {!snoozed && (
          <>
            <span className="night__chip">
              <i className="night__dot" style={{ opacity: 0.35 + micActivity * 0.65 }} />
              {uk.night.mic}
            </span>
            <span className="night__chip">
              {t.motion === 'on' ? `✓ ${uk.night.motion}` : t.motion === 'waiting' ? uk.night.motionWaiting : uk.night.motionOff}
            </span>
          </>
        )}
        {sounds.playing && sounds.id && <span className="night__chip">{uk.night.sounds(uk.sounds.names[sounds.id], minutesLeft(sounds, now))}</span>}
        {t.snoring && <span className="night__chip night__chip--warn">{uk.night.snoring}</span>}
        {t.gaps > 0 && <span className="night__chip night__chip--warn">{uk.night.gaps(t.gaps)}</span>}
      </div>

      <div className="night__center" style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}>
        <div className="night__clock">{fmtTime(now)}</div>
        <div className="night__alarm">
          {snoozed
            ? uk.night.snoozedUntil(fmtTime(t.snoozeUntil!))
            : t.alarmTarget
              ? uk.night.alarmAt(fmtTime(t.alarmTarget), fmtTime(windowFrom))
              : uk.night.noAlarm}
        </div>
        {!snoozed && t.calibrating && t.phase === 'running' && <div className="night__hint">{uk.night.calibrating}</div>}
        {!snoozed && bright && <div className="night__hint">{uk.night.placeHint}</div>}
        {!snoozed &&
          warnings.map((w) => (
            <div key={w} className="night__warn">
              {w}
            </div>
          ))}
      </div>

      {debug && !snoozed && (
        <>
          <p className="night__hint">{uk.night.epochs(t.epochs)}</p>
          <DebugAlarmControls />
          <DebugPanel />
        </>
      )}

      <HoldButton onDone={() => void stopSleep()} disabled={t.phase !== 'running'} label={snoozed ? uk.night.endNight : uk.night.hold} />
    </div>
  );
}
