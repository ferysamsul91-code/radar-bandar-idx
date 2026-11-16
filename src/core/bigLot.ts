import type { SizeCategory, Side, Trade } from "./types";
import { tickDistance } from "./ticks";

export interface BigLotConfig {
  percentile: number;
  lookbackTrades: number;
  minLotByPrice: { maxPrice: number | null; lot: number }[];
  superMultiplier: number;
  superValue: number;
  clusterGapSec: number;
  clusterTickTolerance: number;
  mediumRatio: number;
}

/** Persentil metode nearest-rank. Array kosong -> 0. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

/** Batas harga dibaca sebagai "harga < maxPrice" (sesuai spesifikasi: < 200, 200–1.000, ...). */
export function minLotByPrice(price: number, table: BigLotConfig["minLotByPrice"]): number {
  for (const row of table) if (row.maxPrice === null || price < row.maxPrice) return row.lot;
  return table[table.length - 1]?.lot ?? 0;
}

/** Ambang lot besar per emiten: max(P95 lot N trade terakhir, minLotByPrice, ceil(minValue/(price*100))). */
export class BigLotThreshold {
  private lots: number[] = [];
  private head = 0;

  constructor(private cfg: BigLotConfig) {}

  push(lot: number): void {
    if (this.lots.length < this.cfg.lookbackTrades) this.lots.push(lot);
    else {
      this.lots[this.head] = lot;
      this.head = (this.head + 1) % this.cfg.lookbackTrades;
    }
  }

  get sampleSize(): number {
    return this.lots.length;
  }

  threshold(price: number, minValue: number): number {
    const p = percentile(this.lots, this.cfg.percentile);
    const byPrice = minLotByPrice(price, this.cfg.minLotByPrice);
    const byValue = price > 0 ? Math.ceil(minValue / (price * 100)) : 0;
    return Math.max(p, byPrice, byValue);
  }
}

export function isSuperBig(lot: number, value: number, bigLot: number, cfg: BigLotConfig): boolean {
  return lot >= cfg.superMultiplier * bigLot || value >= cfg.superValue;
}

export function sizeCategory(lot: number, bigLot: number, mediumRatio: number): SizeCategory {
  if (lot >= bigLot) return "BESAR";
  if (lot >= mediumRatio * bigLot) return "SEDANG";
  return "RITEL";
}

export interface Cluster {
  id: number;
  code: string;
  side: Side;
  broker?: string;
  startTs: number;
  lastTs: number;
  lastPrice: number;
  lot: number;
  value: number;
  trades: number;
}

/**
 * Gabungkan split order: sisi sama, harga sama atau +/- N tick dari trade terakhir cluster,
 * broker agresor sama (jika keduanya tampil), jeda <= clusterGapSec.
 */
export class Clusterer {
  private active = new Map<string, Cluster>();
  private nextId = 1;

  constructor(private cfg: Pick<BigLotConfig, "clusterGapSec" | "clusterTickTolerance">) {}

  /** Mengembalikan cluster tempat trade ini masuk. Trade UNKNOWN tidak di-cluster (null). */
  add(t: Trade): { cluster: Cluster; isNew: boolean } | null {
    if (t.side === "UNKNOWN") return null;
    const key = `${t.code}|${t.side}`;
    const broker = t.side === "BUY" ? t.buyerBroker : t.sellerBroker;
    const c = this.active.get(key);
    const fits =
      c !== undefined &&
      t.ts - c.lastTs <= this.cfg.clusterGapSec * 1000 &&
      t.ts >= c.lastTs &&
      tickDistance(t.price, c.lastPrice) <= this.cfg.clusterTickTolerance + 1e-9 &&
      (!broker || !c.broker || broker === c.broker);

    if (fits && c) {
      c.lastTs = t.ts;
      c.lastPrice = t.price;
      c.lot += t.lot;
      c.value += t.value;
      c.trades += 1;
      if (!c.broker && broker) c.broker = broker;
      return { cluster: c, isNew: false };
    }
    const nc: Cluster = {
      id: this.nextId++, code: t.code, side: t.side, broker,
      startTs: t.ts, lastTs: t.ts, lastPrice: t.price, lot: t.lot, value: t.value, trades: 1,
    };
    this.active.set(key, nc);
    return { cluster: nc, isNew: true };
  }
}
