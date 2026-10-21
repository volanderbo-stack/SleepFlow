import { fmtTime } from '../app/format';
import type { DataGap, Stage, StageSegment } from '../db/types';
import { uk } from '../i18n/uk';

const ROWS: Stage[] = ['awake', 'light', 'deep'];
const W = 360;
const H = 170;
const PAD = { left: 64, right: 8, top: 8, bottom: 22 };
const ROW_H = (H - PAD.top - PAD.bottom) / ROWS.length;

interface Props {
  stages: StageSegment[];
  startedAt: number;
  endedAt: number;
  gaps?: DataGap[];
}

/** Гіпнограма: смуги стадій по рядках + ступінчаста лінія переходів. */
export function Hypnogram({ stages, startedAt, endedAt, gaps = [] }: Props) {
  const span = Math.max(1, endedAt - startedAt);
  const x = (t: number) => PAD.left + ((t - startedAt) / span) * (W - PAD.left - PAD.right);
  const rowY = (s: Stage) => PAD.top + ROWS.indexOf(s) * ROW_H;

  const hours: number[] = [];
  const h = new Date(startedAt);
  h.setMinutes(0, 0, 0);
  for (let t = h.getTime() + 3_600_000; t < endedAt; t += 3_600_000) hours.push(t);
  const labelEvery = hours.length > 8 ? 2 : 1;

  const line = stages
    .map((s, i) => {
      const y = rowY(s.stage) + ROW_H / 2;
      return `${i === 0 ? 'M' : 'L'}${x(s.from).toFixed(1)},${y.toFixed(1)} H${x(s.to).toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg className="hypnogram" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={uk.journal.hypnogram}>
      {ROWS.map((s) => (
        <g key={s}>
          <rect x={PAD.left} y={rowY(s)} width={W - PAD.left - PAD.right} height={ROW_H} className={`hyp-row hyp-row--${s}`} />
          <text x={PAD.left - 8} y={rowY(s) + ROW_H / 2} className="hyp-label" textAnchor="end" dominantBaseline="middle">
            {uk.stageShort[s]}
          </text>
        </g>
      ))}
      {hours.map((t, i) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={PAD.top} y2={H - PAD.bottom} className="hyp-grid" />
          {i % labelEvery === 0 && (
            <text x={x(t)} y={H - 6} className="hyp-axis" textAnchor="middle">
              {fmtTime(t).replace(/^0/, '')}
            </text>
          )}
        </g>
      ))}
      {stages.map((s) => (
        <rect
          key={s.from}
          x={x(s.from)}
          y={rowY(s.stage) + 3}
          width={Math.max(0.6, x(s.to) - x(s.from))}
          height={ROW_H - 6}
          rx={2}
          className={`hyp-bar hyp-bar--${s.stage}`}
        />
      ))}
      <path d={line} className="hyp-line" />
      {gaps.map((g) => (
        <rect key={g.from} x={x(g.from)} y={PAD.top} width={x(g.to) - x(g.from)} height={H - PAD.top - PAD.bottom} className="hyp-gap" />
      ))}
    </svg>
  );
}

/** Маленька гіпнограма для списку журналу. */
export function MiniHypnogram({ stages, startedAt, endedAt }: Props) {
  const w = 64;
  const hh = 24;
  const rowH = hh / ROWS.length;
  const span = Math.max(1, endedAt - startedAt);
  return (
    <svg className="mini-hyp" width={w} height={hh} viewBox={`0 0 ${w} ${hh}`} aria-hidden="true">
      {stages.map((s) => {
        const x = ((s.from - startedAt) / span) * w;
        const width = Math.max(0.5, ((s.to - s.from) / span) * w);
        return (
          <rect key={s.from} x={x} y={ROWS.indexOf(s.stage) * rowH + 1} width={width} height={rowH - 2} rx={1} className={`hyp-bar hyp-bar--${s.stage}`} />
        );
      })}
    </svg>
  );
}
