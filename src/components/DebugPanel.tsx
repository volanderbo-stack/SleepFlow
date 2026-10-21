import { useEffect, useRef, useState } from 'react';
import { fmtTime } from '../app/format';
import type { Epoch } from '../db/types';
import { session, type LiveFrame } from '../tracking/session';
import { uk } from '../i18n/uk';

const HISTORY = 600; // 60 с по 100 мс
const W = 340;
const H = 210;
const ROW = H / 3;

/** Живі графіки сигналів (?debug=1): рівень звуку, частки спектра, акселерометр. */
export function DebugPanel() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frames = useRef<LiveFrame[]>([]);
  const [last, setLast] = useState<LiveFrame | null>(null);
  const [epochs, setEpochs] = useState<Epoch[]>([]);

  useEffect(() => {
    let raf = 0;
    let lastUi = 0;
    const off = session.onFrame((f) => {
      frames.current.push(f);
      if (frames.current.length > HISTORY) frames.current.shift();
      if (f.t - lastUi > 500) {
        lastUi = f.t;
        setLast(f);
        setEpochs(session.recentEpochs(6));
      }
    });
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current?.getContext('2d');
      if (!c) return;
      const fs = frames.current;
      const base = session.getStatus().baseline;
      c.clearRect(0, 0, W, H);
      const x = (i: number) => (i / (HISTORY - 1)) * W;

      // Тло хропіння
      c.fillStyle = 'rgba(245,185,113,0.18)';
      fs.forEach((f, i) => f.snoring && c.fillRect(x(i), 0, W / HISTORY + 0.5, H));

      c.strokeStyle = 'rgba(255,255,255,0.08)';
      for (let r = 1; r < 3; r++) {
        c.beginPath();
        c.moveTo(0, r * ROW);
        c.lineTo(W, r * ROW);
        c.stroke();
      }

      const line = (color: string, row: number, value: (f: LiveFrame) => number, min: number, max: number) => {
        c.strokeStyle = color;
        c.lineWidth = 1.2;
        c.beginPath();
        fs.forEach((f, i) => {
          const v = Math.min(1, Math.max(0, (value(f) - min) / (max - min)));
          const y = row * ROW + ROW - 2 - v * (ROW - 4);
          if (i === 0) c.moveTo(x(i), y);
          else c.lineTo(x(i), y);
        });
        c.stroke();
      };
      line('#7c83fd', 0, (f) => f.db, 20, 80);
      // Фон
      const by = ROW - 2 - ((base - 20) / 60) * (ROW - 4);
      c.setLineDash([4, 4]);
      c.strokeStyle = 'rgba(255,255,255,0.35)';
      c.beginPath();
      c.moveTo(0, by);
      c.lineTo(W, by);
      c.stroke();
      c.setLineDash([]);
      line('#f5b971', 1, (f) => f.lowRatio, 0, 1);
      line('#e8eaf6', 1, (f) => f.speechRatio, 0, 1);
      line('#4fd1c5', 2, (f) => f.accel, 0, 1);

      c.fillStyle = 'rgba(232,234,246,0.6)';
      c.font = '10px system-ui';
      c.fillText('дБ (пунктир — фон)', 4, 11);
      c.fillText('спектр: низькі 100–1000 / мова 300–3000', 4, ROW + 11);
      c.fillText('акселерометр Σ|Δa| за 100 мс', 4, 2 * ROW + 11);
    };
    draw();
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="debug">
      <div className="debug__title">{uk.night.debug}</div>
      <canvas ref={canvas} width={W} height={H} className="debug__canvas" />
      {last && (
        <div className="debug__nums">
          <span>{last.db.toFixed(1)} дБ</span>
          <span>фон {session.getStatus().baseline.toFixed(1)}</span>
          <span>low {last.lowRatio.toFixed(2)}</span>
          <span>speech {last.speechRatio.toFixed(2)}</span>
          <span>acc {last.accel.toFixed(3)}</span>
          {last.snoring && <span className="warn">хропіння</span>}
          {last.talking && <span className="warn">розмова</span>}
        </div>
      )}
      <table className="debug__epochs">
        <tbody>
          {epochs.map((e) => (
            <tr key={e.t}>
              <td>{fmtTime(e.t)}</td>
              <td>{e.noiseDb} дБ</td>
              <td>акт. {e.motion.toFixed(2)}</td>
              <td>{e.snore ? 'хроп.' : ''}</td>
              <td>{e.talk ? 'розм.' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
