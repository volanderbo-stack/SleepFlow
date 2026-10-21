import { beforeEach, describe, expect, it } from 'vitest';
import { exportData, importData, ImportError } from './exportImport';
import { deleteAll, deleteDemo, listNights, saveSettings, seedDemo } from './repo';
import { db } from './schema';

beforeEach(async () => {
  await deleteAll();
});

describe('експорт / імпорт', () => {
  it('експорт → видалення → імпорт повертає ті самі дані', async () => {
    await saveSettings({ sleepGoalMin: 450, saveSnoreClips: true });
    await seedDemo();
    const nights = await listNights();
    await db.snoreClips.add({
      nightId: nights[0].id!,
      t: nights[0].startedAt + 60_000,
      durationSec: 8,
      blob: new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'audio/webm' }),
    });

    const file = JSON.parse(JSON.stringify(await exportData()));
    await deleteAll();
    expect(await db.nights.count()).toBe(0);

    const res = await importData(file);
    expect(res).toEqual({ nights: 30, clips: 1 });
    expect(await listNights()).toEqual(nights);
    expect((await db.settings.get('main'))?.sleepGoalMin).toBe(450);
    const clip = (await db.snoreClips.toArray())[0];
    expect(Array.from(new Uint8Array(await clip.blob.arrayBuffer()))).toEqual([1, 2, 3, 250]);
  });

  it('відхиляє чужий файл і не чіпає дані', async () => {
    await seedDemo();
    await expect(importData({ foo: 1 })).rejects.toBeInstanceOf(ImportError);
    expect(await db.nights.count()).toBe(30);
  });
});

describe('демо-дані', () => {
  it('видаляються, не зачіпаючи справжні ночі', async () => {
    await seedDemo();
    const real = { ...(await listNights())[0], isDemo: false, startedAt: Date.now() };
    delete real.id;
    await db.nights.add(real);
    expect(await deleteDemo()).toBe(30);
    const left = await listNights();
    expect(left).toHaveLength(1);
    expect(left[0].isDemo).toBe(false);
  });
});
