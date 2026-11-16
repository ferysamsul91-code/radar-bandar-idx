/**
 * PUBLIKASI ONLINE (opsional, default NONAKTIF): ringkasan REKAP harian dikirim ke repo GitHub milik pengguna,
 * TERENKRIPSI dengan kata sandi pengguna (core/seal.ts), lalu ditampilkan landing page setelah kata sandi dimasukkan.
 * Ini pengecualian yang diminta pengguna atas aturan "tanpa mengirim data ke luar": hanya ringkasan REKAP,
 * hanya ke repo yang diisi pengguna, hanya setelah diaktifkan di halaman pengaturan ekstensi.
 */
import type { ForeignSnap, InstSnap, Rekap } from "./rekap";
import { makeReport, type InstRankRow, type LiveInstRow, type RekapHistory, type RekapReport, type Totals } from "./rekapRange";
import { hhmmToMin, lastTradingDate, wibClock, type SessionCfg } from "./session";

export const PUB_CFG_KEY = "rbPublish"; // rahasia (token & kata sandi): hanya dibaca service worker & halaman pengaturan
export const PUB_ON_KEY = "rbPublishOn"; // boolean, tidak rahasia
export const PUB_STATE_KEY = "rbPublishState";
export const PUB_TOP = 40;
export const PUB_KIND = "radar-rekap-day";
export const pubPath = (day: string) => `data/days/${day}.enc.json`;

export interface PublishCfg {
  repo: string;
  branch: string;
  token: string;
  pass: string;
}
export interface PublishState {
  day: string;
  at: number;
  ok: boolean;
  msg: string;
}

export interface PubForeign {
  code: string;
  foreign: number;
  inst: number | null;
  price: number | null;
  chgPct: number | null;
}
export interface PubSection {
  label: string;
  from: string | null;
  to: string | null;
  totals: Totals;
  instSource: string;
  dataDays: number | null;
  instBuy: InstRankRow[];
  instSell: InstRankRow[];
  foreignBuy: PubForeign[];
  foreignSell: PubForeign[];
  liveInst: LiveInstRow[];
  liveDays: number;
  liveDayCount: number;
  /** Hari bursa dalam rentang yang punya data asing / institusi. */
  coverage: { day: string; foreign: boolean; inst: boolean }[];
}
export interface PublishPayload {
  v: 1;
  day: string;
  generatedAt: number;
  version: string;
  brokers: string[];
  today: PubSection;
  d5: PubSection;
}

function foreignRows(r: Rekap, positive: boolean): PubForeign[] {
  const all = [...r.bothBuy, ...r.bothSell, ...r.divergent, ...r.foreignOnlyBuy, ...r.foreignOnlySell];
  return all
    .filter((x) => x.foreign !== null && (positive ? x.foreign > 0 : x.foreign < 0))
    .sort((a, b) => Math.abs(b.foreign!) - Math.abs(a.foreign!))
    .slice(0, PUB_TOP)
    .map((x) => ({ code: x.code, foreign: x.foreign!, inst: x.inst, price: x.price, chgPct: x.chgPct }));
}

function section(rep: RekapReport): PubSection {
  return {
    label: rep.label, from: rep.from, to: rep.to, totals: rep.totals, instSource: rep.instSource, dataDays: rep.instRank.dataDays,
    instBuy: rep.instRank.buy.slice(0, PUB_TOP), instSell: rep.instRank.sell.slice(0, PUB_TOP),
    foreignBuy: foreignRows(rep.rekap, true), foreignSell: foreignRows(rep.rekap, false),
    liveInst: rep.liveInst.slice(0, 20), liveDays: rep.liveDays, liveDayCount: rep.liveDayCount,
    coverage: rep.coverage.map((c) => ({ day: c.day, foreign: c.fb || c.fs, inst: c.inst || c.trace })),
  };
}

/** Susun ringkasan hari bursa `day` (HARI INI) + 5 hari bursa sebelumnya s.d. `day`. */
export function buildPublishPayload(
  latest: { fb: ForeignSnap | null; fs: ForeignSnap | null; inst: InstSnap | null },
  hist: RekapHistory,
  day: string,
  now: number,
  version: string,
): PublishPayload {
  const t = makeReport(latest, hist, { mode: "today" }, day);
  const d5 = makeReport(latest, hist, { mode: "5d" }, day);
  return {
    v: 1, day, generatedAt: now, version,
    brokers: (t.inst ?? d5.inst)?.brokers.map((b) => b.code) ?? [],
    today: section(t), d5: section(d5),
  };
}

/**
 * Kapan mengirim otomatis (dicek tiap menit di tab Stockbit):
 *  - hari bursa `day` = hari bursa terakhir; bila itu hari ini, tunggu sampai afterWIB (data penutupan final);
 *  - belum terkirim sukses untuk `day`; jeda 5 menit antar percobaan;
 *  - data lengkap (asing beli, asing jual, institusi), atau setelah 18:00 bila setidaknya sebagian ada.
 */
export function decidePublish(now: number, sessions: SessionCfg, afterWIB: string, missing: string[], hasAny: boolean, st: PublishState | null, lastTry: number): string | null {
  const day = lastTradingDate(now, sessions);
  const { min, date } = wibClock(now);
  const after = hhmmToMin(afterWIB) ?? 980;
  if (day === date && min < after) return null;
  if (st && st.day === day && st.ok) return null;
  if (now - lastTry < 5 * 60e3) return null;
  if (missing.length === 0) return day;
  const late = day !== date || min >= 18 * 60;
  return late && hasAny ? day : null;
}

/** Periksa isian pengaturan; kembalikan daftar masalah (kosong = valid). */
export function validatePublishCfg(c: Partial<PublishCfg>, minPass: number): string[] {
  const e: string[] = [];
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(c.repo ?? "")) e.push("Repo harus berbentuk pemilik/nama-repo");
  if (!/^[A-Za-z0-9._/-]+$/.test(c.branch ?? "")) e.push("Branch tidak valid");
  if (!c.token || c.token.length < 20) e.push("Token GitHub belum diisi");
  if ((c.pass ?? "").length < minPass) e.push(`Kata sandi data minimal ${minPass} karakter`);
  return e;
}
