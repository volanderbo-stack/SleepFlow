import { useMemo, useState } from 'react';
import { Bar, BarChart, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { sleepDebt } from '../analysis/debt';
import { weeklyInsights } from '../analysis/insights';
import { buildSeries, nightsInPeriod, summarize, type Period, type StatPoint } from '../analysis/stats';
import { fmtDuration, fmtHM, fmtNoonClock, scoreColor } from '../app/format';
import { useNow } from '../app/hooks';
import { useApp } from '../app/store';
import { ChevronIcon, SparkIcon } from '../components/Icons';
import { InsightList } from '../components/InsightList';
import { uk } from '../i18n/uk';

const PERIODS: Period[] = ['week', 'month', 'year'];
const weekdayFmt = new Intl.DateTimeFormat('uk-UA', { weekday: 'short' });
const monthFmt = new Intl.DateTimeFormat('uk-UA', { month: 'short' });

function label(p: StatPoint, period: Period): string {
  if (period === 'week') return weekdayFmt.format(p.start);
  if (period === 'year') return monthFmt.format(p.start).replace('.', '');
  return String(new Date(p.start).getDate());
}

const axisTick = { fill: 'var(--muted)', fontSize: 11 };
const tooltipStyle = { background: 'var(--card-2)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--text)' };
const MARGIN = { top: 8, right: 4, left: -18, bottom: 0 };

function ChartCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="row-between">
        <h2 className="card__title">{title}</h2>
        {hint && <span className="hint">{hint}</span>}
      </div>
      <div className="chart-box">
        <ResponsiveContainer width="100%" height={170}>
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function StatsScreen() {
  const nights = useApp((s) => s.nights);
  const goal = useApp((s) => s.settings.sleepGoalMin);
  const now = useNow(60_000);
  const [period, setPeriod] = useState<Period>('week');

  const { data, summary, debt, insights, empty } = useMemo(() => {
    const series = buildSeries(nights, period, now);
    const inPeriod = nightsInPeriod(nights, period, now);
    return {
      data: series.map((p) => ({ ...p, label: label(p, period) })),
      summary: summarize(inPeriod),
      debt: sleepDebt(nights, goal, now),
      insights: weeklyInsights(nights, goal, now),
      empty: inPeriod.length === 0,
    };
  }, [nights, period, now, goal]);

  const interval = period === 'month' ? 4 : 0;
  const times = data.flatMap((d) => [d.bedtime, d.wake]).filter((v): v is number => v !== null);
  const timeDomain = times.length ? [Math.floor((Math.min(...times) - 30) / 120) * 120, Math.ceil((Math.max(...times) + 30) / 120) * 120] : [600, 1200];
  const timeStep = timeDomain[1] - timeDomain[0] > 720 ? 240 : 120;
  const timeTicks: number[] = [];
  for (let t = timeDomain[0]; t <= timeDomain[1]; t += timeStep) timeTicks.push(t);

  return (
    <div className="screen">
      <h1 className="screen__title">{uk.stats.title}</h1>

      <div className="segmented" role="tablist">
        {PERIODS.map((p) => (
          <button key={p} role="tab" aria-selected={period === p} className={period === p ? 'is-on' : ''} onClick={() => setPeriod(p)}>
            {uk.stats.periods[p]}
          </button>
        ))}
      </div>

      <section className={`card debt${debt.debtMin > 0 ? ' debt--owe' : ''}`}>
        <span className="label">{debt.surplus ? uk.stats.surplus : uk.stats.debt}</span>
        <strong className="debt__value">
          {debt.surplus ? `+${fmtDuration(-debt.balanceMin)}` : debt.debtMin > 0 ? fmtDuration(debt.debtMin) : uk.stats.debtNone}
        </strong>
        <span className="hint">{uk.stats.debtHint(debt.nights, fmtDuration(goal))}</span>
      </section>

      {empty ? (
        <p className="empty">{uk.stats.noData}</p>
      ) : (
        <>
          <div className="metrics metrics--4">
            <div className="metric">
              <span className="metric__value" style={{ color: scoreColor(summary.avgScore ?? 0) }}>
                {summary.avgScore}
              </span>
              <span className="metric__label">{uk.stats.avgScore}</span>
            </div>
            <div className="metric">
              <span className="metric__value">{fmtHM(summary.avgSleepMin ?? 0)}</span>
              <span className="metric__label">{uk.stats.avgSleep}</span>
            </div>
            <div className="metric">
              <span className="metric__value">{summary.avgBedtime !== null ? fmtNoonClock(summary.avgBedtime) : '—'}</span>
              <span className="metric__label">{uk.stats.avgBed}</span>
            </div>
            <div className="metric">
              <span className="metric__value">{summary.avgWake !== null ? fmtNoonClock(summary.avgWake) : '—'}</span>
              <span className="metric__label">{uk.stats.avgWake}</span>
            </div>
          </div>

          <ChartCard title={uk.stats.duration} hint={uk.stats.goalLine(fmtDuration(goal))}>
            <BarChart data={data} margin={MARGIN}>
              <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval={interval} />
              <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v: number) => [fmtDuration(v * 60), uk.stats.duration]} />
              <ReferenceLine y={goal / 60} stroke="var(--accent-2)" strokeDasharray="4 4" />
              <Bar dataKey="sleepH" radius={[5, 5, 0, 0]} animationDuration={500}>
                {data.map((d) => (
                  <Cell key={d.key} fill={d.score !== null ? scoreColor(d.score) : 'transparent'} />
                ))}
              </Bar>
            </BarChart>
          </ChartCard>

          <ChartCard title={uk.stats.score}>
            <LineChart data={data} margin={MARGIN}>
              <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval={interval} />
              <YAxis domain={[40, 100]} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v, uk.stats.score]} />
              <Line dataKey="score" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3, fill: 'var(--accent)' }} connectNulls animationDuration={500} />
            </LineChart>
          </ChartCard>

          <ChartCard title={uk.stats.schedule}>
            <LineChart data={data} margin={{ ...MARGIN, left: -6 }}>
              <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval={interval} />
              <YAxis domain={timeDomain} reversed ticks={timeTicks} tickFormatter={fmtNoonClock} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [fmtNoonClock(v), name === 'bedtime' ? uk.stats.bed : uk.stats.wake]} />
              <Line dataKey="bedtime" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3, fill: 'var(--accent)' }} connectNulls animationDuration={500} />
              <Line dataKey="wake" stroke="var(--warn)" strokeWidth={2} dot={{ r: 3, fill: 'var(--warn)' }} connectNulls animationDuration={500} />
            </LineChart>
          </ChartCard>
          <div className="legend legend--under">
            <span>
              <i style={{ background: 'var(--accent)' }} />
              {uk.stats.bed}
            </span>
            <span>
              <i style={{ background: 'var(--warn)' }} />
              {uk.stats.wake}
            </span>
          </div>

          <ChartCard title={uk.stats.snore}>
            <BarChart data={data} margin={MARGIN}>
              <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval={interval} />
              <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v: number) => [`${v} хв`, uk.stats.snore]} />
              <Bar dataKey="snoreMin" fill="var(--warn)" radius={[5, 5, 0, 0]} animationDuration={500} />
            </BarChart>
          </ChartCard>
        </>
      )}

      <section className="card card--soft">
        <h2 className="card__title">
          <SparkIcon size={18} className="accent" /> {uk.stats.insights}
        </h2>
        {insights.length ? <InsightList items={insights} /> : <p className="hint">{uk.stats.insightsEmpty}</p>}
      </section>

      <a className="link-card" href="#/stats/why">
        <span className="link-card__emoji" aria-hidden="true">
          🔍
        </span>
        <span className="link-card__main">
          <strong>{uk.stats.why}</strong>
          <span className="hint">{uk.stats.whyHint}</span>
        </span>
        <ChevronIcon size={18} className="dim" />
      </a>
    </div>
  );
}
