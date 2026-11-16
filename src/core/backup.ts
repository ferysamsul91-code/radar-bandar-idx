/**
 * Cadangan riwayat lokal (file JSON yang diunduh / diunggah pengguna sendiri; tidak dikirim ke mana pun).
 * Berisi riwayat REKAP, jejak institusi harian, ringkasan Broker Summary, dan pengaturan.
 */
export const BACKUP_APP = "radar-bandar-idx";
const ALLOWED_PREFIX = ["rbRekapH:", "rbInstH:", "rbLiveH:", "rbRekap:", "rbBS:", "rbChart:"];
const ALLOWED_EXACT = ["rbSettings", "rbScanList"];

export const isBackupKey = (k: string) => ALLOWED_EXACT.includes(k) || ALLOWED_PREFIX.some((p) => k.startsWith(p));

export function makeBackup(all: Record<string, unknown>, now: number): string {
  const items: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(all)) if (isBackupKey(k)) items[k] = v;
  return JSON.stringify({ app: BACKUP_APP, version: 1, exportedAt: new Date(now).toISOString(), count: Object.keys(items).length, items }, null, 1);
}

export function parseBackup(text: string): { items: Record<string, unknown>; count: number; skipped: number; error: string | null } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { items: {}, count: 0, skipped: 0, error: "File bukan JSON yang valid." };
  }
  const d = data as { app?: unknown; items?: unknown };
  if (!d || d.app !== BACKUP_APP || !d.items || typeof d.items !== "object" || Array.isArray(d.items)) {
    return { items: {}, count: 0, skipped: 0, error: "Bukan file cadangan Radar Bandar IDX." };
  }
  const items: Record<string, unknown> = {};
  let skipped = 0;
  for (const [k, v] of Object.entries(d.items as Record<string, unknown>)) {
    if (isBackupKey(k) && v && typeof v === "object") items[k] = v;
    else skipped++;
  }
  return { items, count: Object.keys(items).length, skipped, error: null };
}

/** Ringkas isi riwayat per hari untuk tabel RIWAYAT TERSIMPAN. */
export function historyDays(keys: string[]): string[] {
  const days = new Set<string>();
  for (const k of keys) {
    const m = /^(?:rbRekapH:(?:fbuy|fsell):|rbInstH:|rbLiveH:|rbRekapH:inst:)(\d{4}-\d{2}-\d{2})(?:_(\d{4}-\d{2}-\d{2}))?$/.exec(k);
    if (m && (!m[2] || m[2] === m[1])) days.add(m[1]!);
  }
  return [...days].sort().reverse();
}
