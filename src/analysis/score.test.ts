import { describe, expect, it } from 'vitest';
import { bedtimeDeviation, computeSleepScore, scoreBreakdown } from './score';

const ideal = {
  totalSleepMin: 480,
  goalMin: 480,
  deepPct: 22,
  awakenings: 1,
  sleepOnsetMin: 10,
  bedtimeDeviationMin: 5,
};

describe('computeSleepScore', () => {
  it('ідеальна ніч дає 100', () => {
    expect(computeSleepScore(ideal)).toBe(100);
  });

  it('завжди в межах 0..100', () => {
    expect(computeSleepScore({ ...ideal, totalSleepMin: 0, deepPct: 0, awakenings: 20, sleepOnsetMin: 200, bedtimeDeviationMin: 300 })).toBe(0);
    expect(computeSleepScore({ ...ideal, totalSleepMin: 2000 })).toBeLessThanOrEqual(100);
  });

  it('менше сну — нижчий бал', () => {
    expect(computeSleepScore({ ...ideal, totalSleepMin: 360 })).toBeLessThan(computeSleepScore(ideal));
  });

  it('кожне пробудження після першого знімає бали', () => {
    const a = computeSleepScore({ ...ideal, awakenings: 2 });
    const b = computeSleepScore({ ...ideal, awakenings: 4 });
    expect(a).toBeLessThan(100);
    expect(b).toBeLessThan(a);
  });

  it('без історії регулярність не штрафує', () => {
    expect(scoreBreakdown({ ...ideal, bedtimeDeviationMin: null }).regularity).toBe(15);
  });
});

describe('bedtimeDeviation', () => {
  const at = (day: number, h: number, m: number) => new Date(2026, 9, day, h, m).getTime();

  it('коректно рахує перехід через північ', () => {
    const prev = [at(1, 23, 30), at(3, 0, 30), at(4, 23, 50)];
    // медіана 23:50 → 00:20 наступного дня = 30 хв
    expect(bedtimeDeviation(at(6, 0, 20), prev)).toBe(30);
  });

  it('null без попередніх ночей', () => {
    expect(bedtimeDeviation(at(5, 23, 0), [])).toBeNull();
  });
});
