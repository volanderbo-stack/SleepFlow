import { describe, expect, it } from 'vitest';
import { generateDemoNights } from './demoData';

const NOW = new Date(2026, 9, 21, 12, 0).getTime();

describe('generateDemoNights', () => {
  const nights = generateDemoNights({ now: NOW });

  it('детермінований для однакового seed', () => {
    const again = generateDemoNights({ now: NOW });
    expect(again.map((n) => n.score)).toEqual(nights.map((n) => n.score));
  });

  it('30 ночей у хронологічному порядку і не в майбутньому', () => {
    expect(nights).toHaveLength(30);
    for (let i = 1; i < nights.length; i++) expect(nights[i].startedAt).toBeGreaterThan(nights[i - 1].startedAt);
    expect(nights[nights.length - 1].endedAt).toBeLessThanOrEqual(NOW);
    expect(nights.every((n) => n.isDemo)).toBe(true);
  });

  it('реалістичні значення', () => {
    for (const n of nights) {
      expect(n.totalSleepMin).toBeGreaterThan(5 * 60);
      expect(n.totalSleepMin).toBeLessThan(10.5 * 60);
      expect(n.deepPct).toBeGreaterThan(3);
      expect(n.deepPct).toBeLessThan(40);
      expect(n.score).toBeGreaterThanOrEqual(0);
      expect(n.score).toBeLessThanOrEqual(100);
      expect(n.epochs.length).toBe(Math.floor((n.endedAt - n.startedAt) / 30_000));
    }
  });

  it('пізня кава в середньому погіршує сон', () => {
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const many = generateDemoNights({ now: NOW, count: 120, seed: 7 });
    const withCoffee = many.filter((n) => n.tags.includes('coffee_late')).map((n) => n.score);
    const without = many.filter((n) => !n.tags.includes('coffee_late')).map((n) => n.score);
    expect(avg(withCoffee)).toBeLessThan(avg(without));
  });
});
