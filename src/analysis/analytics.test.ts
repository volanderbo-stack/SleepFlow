import { describe, expect, it } from 'vitest';
import { generateDemoNights } from '../db/demoData';
import type { Night, TagId } from '../db/types';
import { badThreshold, factorEffects } from './correlations';
import { sleepDebt } from './debt';
import { IDEAL_MIN_NIGHTS, idealBedtime } from './idealBedtime';
import { weeklyInsights } from './insights';
import { buildSeries, nightsInPeriod, summarize } from './stats';

const NOW = new Date(2026, 9, 21, 12, 0).getTime();
const DAY = 24 * 60 * 60_000;

/** Мінімальна ніч для тестів аналітики (без епох). i — скільки днів тому був вечір. */
function mk(i: number, o: { bed?: [number, number]; sleepMin?: number; score?: number; tags?: TagId[]; onset?: number } = {}): Night {
  const [h, m] = o.bed ?? [23, 0];
  const ev = new Date(NOW);
  ev.setHours(0, 0, 0, 0);
  ev.setDate(ev.getDate() - i);
  const startedAt = ev.getTime() + (h * 60 + m) * 60_000 + (h < 12 ? DAY : 0);
  const sleepMin = o.sleepMin ?? 450;
  const endedAt = startedAt + (sleepMin + (o.onset ?? 10)) * 60_000;
  return {
    startedAt,
    endedAt,
    alarmTarget: null,
    wakeWindowMin: 30,
    actualWakeAt: endedAt,
    epochs: [],
    stages: [],
    sleepOnsetMin: o.onset ?? 10,
    totalSleepMin: sleepMin,
    awakenings: 1,
    deepPct: 18,
    snoreMin: 0,
    score: o.score ?? 85,
    tags: o.tags ?? [],
    note: '',
    isDemo: false,
  };
}

describe('sleepDebt', () => {
  it('сумує недосип за останні 7 днів', () => {
    const nights = [mk(1, { sleepMin: 420 }), mk(2, { sleepMin: 400 }), mk(3, { sleepMin: 480 }), mk(10, { sleepMin: 200 })];
    const d = sleepDebt(nights, 480, NOW);
    expect(d.nights).toBe(3);
    expect(d.debtMin).toBe(60 + 80);
    expect(d.surplus).toBe(false);
  });

  it('профіцит — борг 0', () => {
    const d = sleepDebt([mk(1, { sleepMin: 540 }), mk(2, { sleepMin: 520 })], 480, NOW);
    expect(d.debtMin).toBe(0);
    expect(d.surplus).toBe(true);
    expect(d.balanceMin).toBe(-100);
  });
});

describe('stats', () => {
  const demo = generateDemoNights({ now: NOW });

  it('тиждень — 7 точок, місяць — 30, рік — 12', () => {
    expect(buildSeries(demo, 'week', NOW)).toHaveLength(7);
    expect(buildSeries(demo, 'month', NOW)).toHaveLength(30);
    expect(buildSeries(demo, 'year', NOW)).toHaveLength(12);
  });

  it('у тижні 7 ночей, остання точка — вчорашній вечір', () => {
    const week = buildSeries(demo, 'week', NOW);
    expect(week.every((p) => p.nights === 1)).toBe(true);
    expect(nightsInPeriod(demo, 'week', NOW)).toHaveLength(7);
    const last = new Date(week[6].start);
    expect(last.getDate()).toBe(20);
  });

  it('рік групує всі ночі по місяцях', () => {
    const year = buildSeries(demo, 'year', NOW);
    expect(year.reduce((s, p) => s + p.nights, 0)).toBe(30);
    expect(year[0].nights).toBe(0);
    expect(year[0].score).toBeNull();
  });

  it('summarize рахує середні', () => {
    const s = summarize([mk(1, { score: 80, sleepMin: 400 }), mk(2, { score: 90, sleepMin: 500 })]);
    expect(s.avgScore).toBe(85);
    expect(s.avgSleepMin).toBe(450);
    expect(s.avgBedtime).toBe(660);
  });
});

describe('factorEffects', () => {
  const nights = [
    ...[1, 2, 3, 4].map((i) => mk(i, { score: 68, tags: ['coffee_late'], onset: 35 })),
    ...[5, 6, 7, 8, 9, 10].map((i) => mk(i, { score: 85 })),
    mk(11, { score: 90, tags: ['sport'] }),
  ];

  it('знаходить шкідливий фактор і рахує різницю у %', () => {
    const e = factorEffects(nights);
    const coffee = e.find((x) => x.id === 'coffee_late')!;
    expect(coffee.withN).toBe(4);
    expect(coffee.avgWith).toBe(68);
    expect(coffee.diffPct).toBeLessThan(-15);
    expect(coffee.onsetDiffMin).toBe(25);
    expect(e[0].id).toBe('coffee_late');
  });

  it('не показує фактори з вибіркою <3 ночей', () => {
    expect(factorEffects(nights).find((x) => x.id === 'sport')).toBeUndefined();
  });

  it('погані ночі — нижній квартиль', () => {
    expect(badThreshold(nights)).toBe(68);
    const coffee = factorEffects(nights).find((x) => x.id === 'coffee_late')!;
    expect(coffee.inBad).toBe(4);
    expect(coffee.badTotal).toBe(4);
  });

  it('на демо-даних пізня кава шкодить', () => {
    const many = generateDemoNights({ now: NOW, count: 90, seed: 11 });
    const coffee = factorEffects(many).find((x) => x.id === 'coffee_late')!;
    expect(coffee.diffPct).toBeLessThan(0);
    expect(coffee.onsetDiffMin).toBeGreaterThan(10);
  });
});

describe('idealBedtime', () => {
  it(`потребує щонайменше ${IDEAL_MIN_NIGHTS} ночей`, () => {
    expect(idealBedtime(Array.from({ length: 13 }, (_, i) => mk(i + 1)), 480)).toBeNull();
  });

  it('обирає час лягання з найкращою оцінкою', () => {
    const nights = [
      ...Array.from({ length: 6 }, (_, i) => mk(i + 1, { bed: [22, 30], score: 92 })),
      ...Array.from({ length: 6 }, (_, i) => mk(i + 7, { bed: [23, 45], score: 75 })),
      ...Array.from({ length: 4 }, (_, i) => mk(i + 13, { bed: [0, 30], score: 65 })),
    ];
    const r = idealBedtime(nights, 450)!;
    expect(r.bedtimeClock).toBe(22 * 60 + 30);
    expect(r.avgScore).toBe(92);
    expect(r.support).toBe(6);
  });

  it('штрафує надто пізнє лягання, з яким не виспатися до підйому', () => {
    // Найвища оцінка о 01:00, але підйом о 07:00 і ціль 8 год — модель обирає раніше.
    const nights = [
      ...Array.from({ length: 5 }, (_, i) => mk(i + 1, { bed: [1, 0], score: 88, sleepMin: 350 })),
      ...Array.from({ length: 10 }, (_, i) => mk(i + 6, { bed: [22, 45], score: 84, sleepMin: 480 })),
    ];
    const r = idealBedtime(nights, 480)!;
    expect(r.bedtimeClock).toBe(22 * 60 + 45);
  });
});

describe('weeklyInsights', () => {
  it('менше 3 ночей — порожньо', () => {
    expect(weeklyInsights([mk(1), mk(2)], 480, NOW)).toEqual([]);
  });

  it('борг і нерегулярність потрапляють у висновки', () => {
    const nights = [
      mk(1, { sleepMin: 360, bed: [22, 0] }),
      mk(2, { sleepMin: 360, bed: [1, 30] }),
      mk(3, { sleepMin: 380, bed: [23, 0] }),
      mk(4, { sleepMin: 360, bed: [0, 45] }),
    ];
    const kinds = weeklyInsights(nights, 480, NOW).map((i) => i.kind);
    expect(kinds).toContain('debt');
    expect(kinds).toContain('irregular');
  });

  it('3–5 висновків на демо-даних, спершу попередження', () => {
    const ins = weeklyInsights(generateDemoNights({ now: NOW }), 480, NOW);
    expect(ins.length).toBeGreaterThanOrEqual(3);
    expect(ins.length).toBeLessThanOrEqual(5);
    const order = { warn: 0, good: 1, info: 2 };
    for (let i = 1; i < ins.length; i++) expect(order[ins[i].tone]).toBeGreaterThanOrEqual(order[ins[i - 1].tone]);
  });
});
