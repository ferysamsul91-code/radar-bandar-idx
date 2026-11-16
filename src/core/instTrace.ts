/**
 * JEJAK INSTITUSI (dari running trade live).
 * Definisi (semua ambang di thresholds.json "instTrace", ESTIMASI sampai dikalibrasi data live):
 *  - dilihat dari sisi BROKER: broker pembeli = BELI, broker penjual = JUAL (bukan sisi agresor);
 *  - broker ritel dikecualikan (bawaan XL, XC); trade silang (broker beli = broker jual) dilewati;
 *  - hanya trade bernilai >= minTradeValue (order dipecah tetap terjumlah);
 *  - "rangkaian" = trade broker yang sama, emiten & sisi sama, jeda antar-trade <= windowSec;
 *  - rangkaian dianggap JEJAK bila jumlah trade >= minTrades DAN total nilai >= minRunValue.
 * Hanya pasar reguler (RG).
 */
import type { InvestorType, Trade } from "./types";

export interface InstTraceCfg {
  windowSec: number;
  minTrades: number;
  minRunValue: number;
  minTradeValue: number;
  excludeBrokers: string[];
  skipCross: boolean;
}

export type TraceSide = "BELI" | "JUAL";

export interface InstEvent {
  id: number;
  code: string;
  broker: string;
  side: TraceSide;
  startTs: number;
  lastTs: number;
  trades: number;
  lot: number;
  value: number;
  /** Harga rata-rata tertimbang lot. */
  avg: number;
  /** Porsi nilai dari investor bertanda [F] (null bila tipe investor tidak tampil). */
  foreignShare: number | null;
}

export interface BrokerNet {
  code: string;
  broker: string;
  buy: number;
  sell: number;
  buyLot: number;
  sellLot: number;
  buyAvg: number | null;
  sellAvg: number | null;
  runs: number;
}

interface Run {
  code: string;
  broker: string;
  side: TraceSide;
  startTs: number;
  lastTs: number;
  trades: number;
  lot: number;
  value: number;
  pxLot: number;
  fValue: number;
  typed: number;
  event: InstEvent | null;
}

export class InstTraceTracker {
  private runs = new Map<string, Run>();
  private seq = 0;
  private excluded: Set<string>;
  /** Kejadian terbaru dulu (maks 200). */
  readonly events: InstEvent[] = [];

  constructor(private cfg: InstTraceCfg) {
    this.excluded = new Set(cfg.excludeBrokers.map((b) => b.trim().toUpperCase()));
  }

  /** Masukkan satu trade; kembalikan kejadian yang BARU memenuhi syarat (bukan update). */
  add(t: Trade): InstEvent[] {
    if (t.board !== "RG" || t.value < this.cfg.minTradeValue) return [];
    const buyer = t.buyerBroker?.toUpperCase();
    const seller = t.sellerBroker?.toUpperCase();
    if (this.cfg.skipCross && buyer && buyer === seller) return [];
    const fresh: InstEvent[] = [];
    for (const [broker, side, type] of [[buyer, "BELI", t.buyerType], [seller, "JUAL", t.sellerType]] as [string | undefined, TraceSide, InvestorType | undefined][]) {
      if (!broker || this.excluded.has(broker)) continue;
      const e = this.push(t, broker, side, type);
      if (e) fresh.push(e);
    }
    return fresh;
  }

  private push(t: Trade, broker: string, side: TraceSide, type: InvestorType | undefined): InstEvent | null {
    const key = `${t.code}|${broker}|${side}`;
    let r = this.runs.get(key);
    if (!r || t.ts - r.lastTs > this.cfg.windowSec * 1000 || t.ts < r.lastTs - 60_000) {
      r = { code: t.code, broker, side, startTs: t.ts, lastTs: t.ts, trades: 0, lot: 0, value: 0, pxLot: 0, fValue: 0, typed: 0, event: null };
      this.runs.set(key, r);
    }
    r.lastTs = Math.max(r.lastTs, t.ts);
    r.trades++;
    r.lot += t.lot;
    r.value += t.value;
    r.pxLot += t.price * t.lot;
    if (type) {
      r.typed += t.value;
      if (type === "F") r.fValue += t.value;
    }
    const qualifies = r.trades >= this.cfg.minTrades && r.value >= this.cfg.minRunValue;
    if (!qualifies) return null;
    const snap = {
      code: r.code, broker: r.broker, side: r.side, startTs: r.startTs, lastTs: r.lastTs, trades: r.trades, lot: r.lot, value: r.value,
      avg: r.lot ? Math.round(r.pxLot / r.lot) : 0, foreignShare: r.typed ? r.fValue / r.typed : null,
    };
    if (r.event) {
      Object.assign(r.event, snap);
      return null;
    }
    r.event = { id: ++this.seq, ...snap };
    this.events.unshift(r.event);
    if (this.events.length > 200) this.events.length = 200;
    return r.event;
  }

  /** Net per broker per emiten dari semua kejadian (rangkaian yang memenuhi syarat). */
  nets(): BrokerNet[] {
    const m = new Map<string, BrokerNet & { bPx: number; sPx: number }>();
    for (const e of this.events) {
      const k = `${e.code}|${e.broker}`;
      const n = m.get(k) ?? { code: e.code, broker: e.broker, buy: 0, sell: 0, buyLot: 0, sellLot: 0, buyAvg: null, sellAvg: null, runs: 0, bPx: 0, sPx: 0 };
      n.runs++;
      if (e.side === "BELI") {
        n.buy += e.value;
        n.buyLot += e.lot;
        n.bPx += e.avg * e.lot;
      } else {
        n.sell += e.value;
        n.sellLot += e.lot;
        n.sPx += e.avg * e.lot;
      }
      m.set(k, n);
    }
    return [...m.values()]
      .map(({ bPx, sPx, ...n }) => ({ ...n, buyAvg: n.buyLot ? Math.round(bPx / n.buyLot) : null, sellAvg: n.sellLot ? Math.round(sPx / n.sellLot) : null }))
      .sort((a, b) => Math.abs(b.buy - b.sell) - Math.abs(a.buy - a.sell));
  }

  isActive(e: InstEvent, now: number): boolean {
    return now - e.lastTs <= this.cfg.windowSec * 1000;
  }

  get excludedBrokers(): string[] {
    return [...this.excluded];
  }
}

export const DEFAULT_INST_TRACE: InstTraceCfg = {
  windowSec: 300, minTrades: 3, minRunValue: 1_000_000_000, minTradeValue: 100_000_000, excludeBrokers: ["XL", "XC"], skipCross: true,
};
