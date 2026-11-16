/**
 * Pengaturan pengguna (disimpan di chrome.storage.local "rbSettings").
 * Default = thresholds.json + brokers.json bawaan; simpanan pengguna di-merge di atasnya.
 */
import type { BrokerTable } from "./brokerMap";

export const BROKER_CATS = ["FOREIGN_INST", "LOCAL_INST", "RETAIL_HEAVY"] as const;
export type BrokerCat = (typeof BROKER_CATS)[number];
export interface BrokerRow {
  code: string;
  cat: BrokerCat;
  name: string;
}

export interface UserSettings {
  thresholds: Record<string, unknown>;
  brokers: BrokerTable;
  watchlist: string[];
  blacklist: string[];
  toastWatchlistOnly: boolean;
  sound: boolean;
  /** Selalu false di versi ini: parser WebSocket belum dibuat. */
  wsTap: boolean;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const kind = (x: unknown) => (x === null ? "null" : Array.isArray(x) ? "array" : typeof x);

/**
 * Gabung `over` ke `base`. Hanya kunci yang ada di base yang diterima dan tipenya harus sama
 * (null di base boleh diganti angka/null). Kunci "_..." (catatan) diabaikan. Kembalikan error per kunci.
 */
export function mergeChecked(base: unknown, over: unknown, path = ""): { value: unknown; errors: string[] } {
  if (!isObj(base) || !isObj(over)) {
    const kb = kind(base);
    const ko = kind(over);
    const ok = kb === ko || (kb === "null" && (ko === "number" || ko === "string")) || ((kb === "number" || kb === "string") && ko === "null" && path.endsWith("maxPrice"));
    if (!ok) return { value: base, errors: [`${path || "(root)"}: harus ${kb}, bukan ${ko}`] };
    if (ko === "number" && !Number.isFinite(over)) return { value: base, errors: [`${path}: angka tidak valid`] };
    return { value: over, errors: [] };
  }
  const out: Record<string, unknown> = { ...base };
  const errors: string[] = [];
  for (const [k, v] of Object.entries(over)) {
    if (k.startsWith("_")) continue;
    const p = path ? `${path}.${k}` : k;
    if (!(k in base)) {
      errors.push(`${p}: kunci tidak dikenal`);
      continue;
    }
    const r = mergeChecked(base[k], v, p);
    out[k] = r.value;
    errors.push(...r.errors);
  }
  return { value: out, errors };
}

/** "bbca, tlkm  goto" -> ["BBCA","TLKM","GOTO"] (unik, hanya huruf/angka 2–7 karakter). */
export function parseCodeList(s: string): string[] {
  const out: string[] = [];
  for (const raw of s.split(/[\s,;]+/)) {
    const c = raw.trim().toUpperCase();
    if (/^[A-Z0-9]{2,7}$/.test(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

export function brokerRows(table: BrokerTable): BrokerRow[] {
  const rows: BrokerRow[] = [];
  for (const cat of BROKER_CATS) {
    const g = table[cat];
    if (isObj(g)) for (const [code, name] of Object.entries(g)) rows.push({ code: code.toUpperCase(), cat, name: String(name) });
  }
  return rows;
}

/** Baris tabel -> brokers.json. Kode kosong dilewati; kode ganda: baris terakhir menang. Catatan "_note" dipertahankan. */
export function rowsToBrokerTable(rows: BrokerRow[], note?: string): BrokerTable {
  const t: BrokerTable = {};
  if (note) t._note = note;
  for (const cat of BROKER_CATS) t[cat] = {};
  for (const r of rows) {
    const code = r.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{2}$/.test(code)) continue;
    for (const cat of BROKER_CATS) delete (t[cat] as Record<string, string>)[code];
    (t[r.cat] as Record<string, string>)[code] = r.name.trim();
  }
  return t;
}

export function defaultSettings(thresholds: Record<string, unknown>, brokers: BrokerTable): UserSettings {
  return {
    thresholds: structuredClone(thresholds),
    brokers: structuredClone(brokers),
    watchlist: [],
    blacklist: [],
    toastWatchlistOnly: false,
    sound: Boolean((thresholds.toast as { sound?: boolean } | undefined)?.sound),
    wsTap: false,
  };
}

/** Pulihkan simpanan; bagian rusak diganti default. */
export function loadSettings(stored: unknown, defaults: UserSettings): UserSettings {
  if (!isObj(stored)) return defaults;
  const th = mergeChecked(defaults.thresholds, stored.thresholds ?? {});
  const brokers = isObj(stored.brokers) ? rowsToBrokerTable(brokerRows(stored.brokers as BrokerTable), String(defaults.brokers._note ?? "")) : defaults.brokers;
  const list = (x: unknown) => (Array.isArray(x) ? parseCodeList(x.join(" ")) : []);
  return {
    thresholds: th.value as Record<string, unknown>,
    brokers,
    watchlist: list(stored.watchlist),
    blacklist: list(stored.blacklist),
    toastWatchlistOnly: stored.toastWatchlistOnly === true,
    sound: stored.sound === true,
    wsTap: false,
  };
}
