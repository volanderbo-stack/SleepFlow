import Dexie, { type Table } from 'dexie';
import type { Night, Settings, SnoreClip } from './types';

export class SleepFlowDB extends Dexie {
  nights!: Table<Night, number>;
  snoreClips!: Table<SnoreClip, number>;
  settings!: Table<Settings, string>;

  constructor(name = 'sleepflow') {
    super(name);
    this.version(1).stores({
      // Булеві значення (isDemo) не індексуються в IndexedDB — фільтруємо їх у коді.
      nights: '++id, startedAt',
      snoreClips: '++id, nightId',
      settings: 'id',
    });
  }
}

export const db = new SleepFlowDB();
