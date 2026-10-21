import { rescoreNights } from '../analysis/finalize';
import { generateDemoNights } from './demoData';
import { db } from './schema';
import { DEFAULT_SETTINGS, type Night, type Settings, type SnoreClip } from './types';

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get('main')) ?? { ...DEFAULT_SETTINGS };
}

export async function saveSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch, id: 'main' as const };
  await db.settings.put(next);
  return next;
}

/** Усі ночі, від найновішої. */
export async function listNights(): Promise<Night[]> {
  return db.nights.orderBy('startedAt').reverse().toArray();
}

export function getNight(id: number): Promise<Night | undefined> {
  return db.nights.get(id);
}

export function addNight(n: Night): Promise<number> {
  return db.nights.add(n);
}

export async function updateNight(id: number, patch: Partial<Night>): Promise<void> {
  await db.nights.update(id, patch);
}

export async function deleteNight(id: number): Promise<void> {
  await db.transaction('rw', db.nights, db.snoreClips, async () => {
    await db.snoreClips.where('nightId').equals(id).delete();
    await db.nights.delete(id);
  });
}

export function addClip(clip: SnoreClip): Promise<number> {
  return db.snoreClips.add(clip);
}

export function putNight(n: Night): Promise<number> {
  return db.nights.put(n);
}

export function listClips(nightId: number): Promise<SnoreClip[]> {
  return db.snoreClips.where('nightId').equals(nightId).sortBy('t');
}

export async function seedDemo(): Promise<number> {
  const s = await getSettings();
  const nights = generateDemoNights({ goalMin: s.sleepGoalMin, wakeWindowMin: s.defaultWakeWindow });
  await db.nights.bulkAdd(nights);
  await rescoreAll(s.sleepGoalMin);
  return nights.length;
}

export async function hasDemo(): Promise<boolean> {
  return (await db.nights.filter((n) => n.isDemo).count()) > 0;
}

export async function deleteDemo(): Promise<number> {
  const ids = (await db.nights.filter((n) => n.isDemo).primaryKeys()) as number[];
  await db.transaction('rw', db.nights, db.snoreClips, async () => {
    await db.snoreClips.where('nightId').anyOf(ids).delete();
    await db.nights.bulkDelete(ids);
  });
  await rescoreAll((await getSettings()).sleepGoalMin);
  return ids.length;
}

export async function deleteAll(): Promise<void> {
  await db.transaction('rw', db.nights, db.snoreClips, db.settings, async () => {
    await db.nights.clear();
    await db.snoreClips.clear();
    await db.settings.clear();
  });
}

/** Перераховує оцінки всіх ночей (регулярність залежить від сусідніх ночей, бал — від цілі). */
export async function rescoreAll(goalMin: number): Promise<number> {
  const changed = rescoreNights(await db.nights.toArray(), goalMin);
  if (changed.length) await db.nights.bulkPut(changed);
  return changed.length;
}

/** Перший запуск: створює налаштування і демо-дані, щоб застосунок не був порожнім. */
export async function ensureInitialized(): Promise<void> {
  const s = await db.settings.get('main');
  if (s?.onboardingDone) return;
  if ((await db.nights.count()) === 0) await seedDemo();
  await saveSettings({ onboardingDone: true });
}
