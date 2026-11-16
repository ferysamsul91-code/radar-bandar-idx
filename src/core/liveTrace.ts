/**
 * POLA LOT BESAR LIVE (tanpa kode broker; BEI menyembunyikan broker selama jam bursa).
 *  - rangkaian = trade RG emiten & sisi agresor sama (Buy/Sell), tiap trade >= minTradeValue, jeda <= windowSec;
 *  - lolos bila jumlah trade >= minTrades DAN total >= minRunValue;
 *  - kategori dari F Buy / F Sell widget orderbook (akumulasi asing hari ini, bergerak live):
 *      ASING            : kenaikan F Buy (rangkaian BELI) / F Sell (rangkaian JUAL) selama rangkaian >= foreignShareMin x nilai;
 *      INSTITUSI/LOKAL  : F tidak naik sebanyak itu -> pola lot besar beruntun non-asing (ESTIMASI);
 *      ?                : emiten tidak punya widget orderbook terbuka (asing tak terukur).
 * Sisi = sisi agresor (pemukul). Akumulasi pasif di bid tercatat sebagai rangkaian JUAL agresor.
 */
import type { Trade } from "./types";

export interface LiveTraceCfg {
  windowSec: number;
  minTrades: number;
  minRunValue: number;
  minTradeValue: number;
  foreignShareMin: number;
}
export type LiveCategory = "ASING" | "INSTITUSI/LOKAL" | "?";
export type LiveSide = "BELI" | "JUAL";

export interface LiveEvent {
  id: number;
  code: string;
  side: LiveSide;
  startTs: number;
  lastTs: number;
  trades: number;
  lot: number;
  value: number;
  avg: number;
  /** Kenaikan F Buy (BELI) / F Sell (JUAL) selama rangkaian, Rupiah; null bila tak ada widget. */
  foreignDelta: number | null;
  foreignShare: number | null;
  category: LiveCategory;
}

interface Run {
  code: string;
  side: LiveSide;
  startTs: number;
  lastTs: number;
  trades: number;
  lot: number;
  value: number;
  pxLot: number;
  fStart: number | null;
  event: LiveEvent | null;
}

export class LiveTraceTracker {
  private runs = new Map<string, Run>();
  /** Nilai F Buy / F Sell terakhir per emiten dari widget orderbook. */
  private foreign = new Map<string, { fb: number; fs: number; ts: number }>();
  private seq = 0;
  readonly events: LiveEvent[] = [];

  constructor(private cfg: LiveTraceCfg) {}

  /** Catat F Buy / F Sell terbaru dari snapshot widget orderbook. */
  onForeign(code: string, ts: number, fb: number | null | undefined, fs: number | null | undefined): void {
    if (fb == null || fs == null) return;
    this.foreign.set(code, { fb, fs, ts });
    // Perbarui kategori rangkaian aktif emiten ini (F bisa bergerak sedikit setelah trade).
    for (const r of this.runs.values()) if (r.code === code && r.event) this.refresh(r);
  }

  private fNow(code: string, side: LiveSide): number | null {
    const f = this.foreign.get(code);
    return f ? (side === "BELI" ? f.fb : f.fs) : null;
  }

  private refresh(r: Run): void {
    const e = r.event!;
    const now = this.fNow(r.code, r.side);
    const delta = r.fStart !== null && now !== null ? Math.max(0, now - r.fStart) : null;
    e.foreignDelta = delta;
    e.foreignShare = delta === null ? null : Math.min(1, delta / r.value);
    e.category = e.foreignShare === null ? "?" : e.foreignShare >= this.cfg.foreignShareMin ? "ASING" : "INSTITUSI/LOKAL";
  }

  /** Masukkan trade; kembalikan kejadian yang BARU lolos syarat. */
  add(t: Trade): LiveEvent | null {
    if (t.board !== "RG" || t.side === "UNKNOWN" || t.value < this.cfg.minTradeValue) return null;
    const side: LiveSide = t.side === "BUY" ? "BELI" : "JUAL";
    const key = `${t.code}|${side}`;
    let r = this.runs.get(key);
    if (!r || t.ts - r.lastTs > this.cfg.windowSec * 1000 || t.ts < r.lastTs - 60_000) {
      // Patokan F diambil sebelum trade pertama ikut terhitung (snapshot terakhir).
      r = { code: t.code, side, startTs: t.ts, lastTs: t.ts, trades: 0, lot: 0, value: 0, pxLot: 0, fStart: this.fNow(t.code, side), event: null };
      this.runs.set(key, r);
    }
    r.lastTs = Math.max(r.lastTs, t.ts);
    r.trades++;
    r.lot += t.lot;
    r.value += t.value;
    r.pxLot += t.price * t.lot;
    if (r.trades < this.cfg.minTrades || r.value < this.cfg.minRunValue) return null;
    const base = { code: r.code, side: r.side, startTs: r.startTs, lastTs: r.lastTs, trades: r.trades, lot: r.lot, value: r.value, avg: Math.round(r.pxLot / r.lot) };
    if (r.event) {
      Object.assign(r.event, base);
      this.refresh(r);
      return null;
    }
    r.event = { id: ++this.seq, ...base, foreignDelta: null, foreignShare: null, category: "?" };
    this.refresh(r);
    this.events.unshift(r.event);
    if (this.events.length > 200) this.events.length = 200;
    return r.event;
  }

  isActive(e: LiveEvent, now: number): boolean {
    return now - e.lastTs <= this.cfg.windowSec * 1000;
  }

  /** Ringkas per emiten: nilai rangkaian BELI/JUAL per kategori (ASING / INSTITUSI/LOKAL; sisanya "?"). */
  summary(): LiveSumRow[] {
    return summarize(this.events);
  }
}

/** Ringkasan per emiten dari daftar rangkaian (kejadian live atau rekaman harian). */
export function summarize(events: readonly Pick<LiveEvent, "code" | "side" | "value" | "category">[]): LiveSumRow[] {
  const m = new Map<string, LiveSumRow>();
  for (const e of events) {
    const s = m.get(e.code) ?? { code: e.code, buy: 0, sell: 0, asingBuy: 0, asingSell: 0, instBuy: 0, instSell: 0, runs: 0, instRuns: 0 };
    s.runs++;
    const inst = e.category === "INSTITUSI/LOKAL";
    if (inst) s.instRuns++;
    if (e.side === "BELI") {
      s.buy += e.value;
      if (e.category === "ASING") s.asingBuy += e.value;
      if (inst) s.instBuy += e.value;
    } else {
      s.sell += e.value;
      if (e.category === "ASING") s.asingSell += e.value;
      if (inst) s.instSell += e.value;
    }
    m.set(e.code, s);
  }
  return [...m.values()].sort((a, b) => Math.abs(b.buy - b.sell) - Math.abs(a.buy - a.sell));
}

/** Rekaman rangkaian ringkas untuk riwayat harian (kejadian di memori dibatasi 200; rekaman ini terakumulasi sepanjang hari). */
export interface LiveRec {
  code: string;
  side: LiveSide;
  startTs: number;
  lastTs: number;
  trades: number;
  value: number;
  category: LiveCategory;
}

/**
 * Gabungkan rekaman tersimpan dengan kejadian terbaru. Rangkaian emiten & sisi sama yang rentang waktunya bertumpang
 * (mis. dideteksi ulang setelah halaman dimuat ulang) dianggap satu: ambil rentang gabungan, nilai & trade terbesar,
 * kategori dari versi dengan nilai terbesar. Tanpa tumpang -> rangkaian baru.
 */
export function mergeLive(stored: readonly LiveRec[], fresh: readonly LiveEvent[]): LiveRec[] {
  const out = stored.map((r) => ({ ...r }));
  for (const e of fresh) {
    const hit = out.find((r) => r.code === e.code && r.side === e.side && e.startTs <= r.lastTs && e.lastTs >= r.startTs);
    if (!hit) {
      out.push({ code: e.code, side: e.side, startTs: e.startTs, lastTs: e.lastTs, trades: e.trades, value: e.value, category: e.category });
      continue;
    }
    if (e.value >= hit.value || hit.category === "?") hit.category = e.category === "?" ? hit.category : e.category;
    hit.startTs = Math.min(hit.startTs, e.startTs);
    hit.lastTs = Math.max(hit.lastTs, e.lastTs);
    hit.trades = Math.max(hit.trades, e.trades);
    hit.value = Math.max(hit.value, e.value);
  }
  return out.sort((a, b) => a.startTs - b.startTs);
}

/** Ringkasan pola per emiten (juga disimpan harian sebagai "rbLiveH:YYYY-MM-DD"). */
export interface LiveSumRow {
  code: string;
  buy: number;
  sell: number;
  asingBuy: number;
  asingSell: number;
  instBuy: number;
  instSell: number;
  runs: number;
  instRuns: number;
}

export const DEFAULT_LIVE_TRACE: LiveTraceCfg = {
  windowSec: 300, minTrades: 3, minRunValue: 1_000_000_000, minTradeValue: 100_000_000, foreignShareMin: 0.5,
};
