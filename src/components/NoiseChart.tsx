import { Area, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtTime } from '../app/format';
import type { Epoch } from '../db/types';
import { uk } from '../i18n/uk';

interface Point {
  t: number;
  noise: number;
  snore: number;
}

/** Розмір кошика: ~100 точок на графік, від 30 с (коротка сесія) до 5 хв (повна ніч). */
function bucketMs(epochs: Epoch[]): number {
  if (epochs.length < 2) return 30_000;
  const span = epochs[epochs.length - 1].t - epochs[0].t;
  return Math.min(5 * 60_000, Math.max(30_000, Math.ceil(span / 100 / 30_000) * 30_000));
}

/** Агрегує епохи в кошики: максимум шуму і хвилини хропіння. */
export function bucketEpochs(epochs: Epoch[]): Point[] {
  const size = bucketMs(epochs);
  const map = new Map<number, Point>();
  for (const e of epochs) {
    const key = Math.floor(e.t / size) * size;
    const p = map.get(key) ?? { t: key, noise: 0, snore: 0 };
    p.noise = Math.max(p.noise, e.noiseDb);
    if (e.snore) p.snore += 0.5;
    map.set(key, p);
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

export function NoiseChart({ epochs }: { epochs: Epoch[] }) {
  const data = bucketEpochs(epochs);
  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height={150}>
        <ComposedChart data={data} margin={{ top: 6, right: 4, left: -22, bottom: 0 }}>
          <defs>
            <linearGradient id="noiseFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity={0.45} />
              <stop offset="1" stopColor="var(--accent)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="t"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(t: number) => fmtTime(t)}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis yAxisId="db" domain={[20, (max: number) => Math.ceil((max + 5) / 10) * 10]} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="snore" orientation="right" hide domain={[0, 5]} />
          <Tooltip
            contentStyle={{ background: 'var(--card-2)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--text)' }}
            labelFormatter={(t: number) => fmtTime(t)}
            formatter={(v: number, name: string) =>
              name === 'snore' ? [`${v} хв`, uk.journal.snoreLegend] : [`${Math.round(v)} дБ`, uk.journal.noiseShort]
            }
          />
          <Area yAxisId="db" dataKey="noise" type="monotone" stroke="var(--accent)" strokeWidth={1.5} fill="url(#noiseFill)" isAnimationActive={false} />
          <Area yAxisId="snore" dataKey="snore" type="stepAfter" stroke="none" fill="var(--warn)" fillOpacity={0.75} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="legend">
        <span>
          <i style={{ background: 'var(--accent)' }} />
          {uk.journal.noiseLegend}
        </span>
        <span>
          <i style={{ background: 'var(--warn)' }} />
          {uk.journal.snoreLegend}
        </span>
      </div>
    </div>
  );
}
