import { db } from './schema';
import { DEFAULT_SETTINGS, type Night, type Settings } from './types';

export const EXPORT_APP = 'SleepFlow';
export const EXPORT_VERSION = 1;

export interface ExportedClip {
  id?: number;
  nightId: number;
  t: number;
  durationSec: number;
  mime: string;
  /** base64 */
  data: string;
}

export interface ExportFile {
  app: typeof EXPORT_APP;
  version: number;
  exportedAt: string;
  settings: Settings;
  nights: Night[];
  snoreClips: ExportedClip[];
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function exportData(): Promise<ExportFile> {
  const [settings, nights, clips] = await Promise.all([
    db.settings.get('main'),
    db.nights.orderBy('startedAt').toArray(),
    db.snoreClips.toArray(),
  ]);
  const snoreClips: ExportedClip[] = [];
  for (const c of clips) {
    snoreClips.push({
      id: c.id,
      nightId: c.nightId,
      t: c.t,
      durationSec: c.durationSec,
      mime: c.blob.type || 'audio/webm',
      data: bytesToBase64(new Uint8Array(await c.blob.arrayBuffer())),
    });
  }
  return {
    app: EXPORT_APP,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: settings ?? { ...DEFAULT_SETTINGS },
    nights,
    snoreClips,
  };
}

export class ImportError extends Error {}

function isNight(n: unknown): n is Night {
  if (!n || typeof n !== 'object') return false;
  const o = n as Record<string, unknown>;
  return (
    typeof o.startedAt === 'number' &&
    typeof o.endedAt === 'number' &&
    Array.isArray(o.epochs) &&
    Array.isArray(o.stages) &&
    Array.isArray(o.tags)
  );
}

export function parseExport(data: unknown): ExportFile {
  if (!data || typeof data !== 'object') throw new ImportError('Файл не схожий на експорт SleepFlow.');
  const f = data as Partial<ExportFile>;
  if (f.app !== EXPORT_APP) throw new ImportError('Файл не схожий на експорт SleepFlow.');
  if (typeof f.version !== 'number' || f.version > EXPORT_VERSION)
    throw new ImportError('Файл створено новішою версією застосунку.');
  if (!Array.isArray(f.nights) || !f.nights.every(isNight)) throw new ImportError('Пошкоджені дані ночей.');
  return {
    app: EXPORT_APP,
    version: f.version,
    exportedAt: String(f.exportedAt ?? ''),
    settings: { ...DEFAULT_SETTINGS, ...(f.settings ?? {}), id: 'main' },
    nights: f.nights,
    snoreClips: Array.isArray(f.snoreClips) ? f.snoreClips : [],
  };
}

/** Повністю замінює дані на пристрої вмістом файлу. */
export async function importData(data: unknown): Promise<{ nights: number; clips: number }> {
  const f = parseExport(data);
  await db.transaction('rw', db.nights, db.snoreClips, db.settings, async () => {
    await db.nights.clear();
    await db.snoreClips.clear();
    await db.settings.clear();
    await db.settings.put(f.settings);
    await db.nights.bulkAdd(f.nights);
    await db.snoreClips.bulkAdd(
      f.snoreClips.map((c) => ({
        ...(c.id !== undefined ? { id: c.id } : {}),
        nightId: c.nightId,
        t: c.t,
        durationSec: c.durationSec,
        blob: new Blob([base64ToBytes(c.data)], { type: c.mime }),
      })),
    );
  });
  return { nights: f.nights.length, clips: f.snoreClips.length };
}
