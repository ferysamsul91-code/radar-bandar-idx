import type { WindowMetrics } from "./windows";

export type Status = "FLOW KUAT" | "PADA BELI" | "CUAN MENANTI" | "PADA JUALAN" | "NETRAL";

export interface StatusConfig {
  flowKuat: { buyPct3m: number; requireBigNetPositive: boolean };
  padaBeli: { buyPct30s: number };
  cuanMenanti: { buyPct15m: number; maxVwapDistance: number };
  padaJualan: { maxBuyPct3m: number };
  rame: { beli: number; jual: number };
}

/** Window per peran: short/mid/long = windowsSec[0..2] mode aktif (scalping: 30s/3m/15m). */
export interface RoleMetrics {
  short: WindowMetrics;
  mid: WindowMetrics;
  long: WindowMetrics;
}

export interface StatusInput {
  m: RoleMetrics;
  flowKuatAggrFlow: number;
  /** (harga - VWAP) / VWAP; null jika VWAP belum ada. */
  vwapDist: number | null;
  bidBertahan: boolean;
}

const ge = (x: number | null, t: number) => x !== null && x >= t;
const le = (x: number | null, t: number) => x !== null && x <= t;

/** Satu status utama. Prioritas: FLOW KUAT > PADA BELI > CUAN MENANTI > PADA JUALAN > NETRAL. */
export function computeStatus(i: StatusInput, c: StatusConfig): Status {
  const { short, mid, long } = i.m;
  if (
    ge(mid.buyPct, c.flowKuat.buyPct3m) &&
    mid.aggrFlow >= i.flowKuatAggrFlow &&
    (!c.flowKuat.requireBigNetPositive || mid.bigNet > 0)
  ) return "FLOW KUAT";
  if (ge(short.buyPct, c.padaBeli.buyPct30s) && short.bigBuy > 0) return "PADA BELI";
  if (ge(long.buyPct, c.cuanMenanti.buyPct15m) && i.vwapDist !== null && i.vwapDist <= c.cuanMenanti.maxVwapDistance && i.bidBertahan) {
    return "CUAN MENANTI";
  }
  if (le(mid.buyPct, c.padaJualan.maxBuyPct3m) && mid.bigSell > mid.bigBuy) return "PADA JUALAN";
  return "NETRAL";
}

export function rameLabel(mid: WindowMetrics, c: StatusConfig): "RAME BELI" | "RAME JUAL" | "SEIMBANG" | "SEPI" {
  if (mid.buyPct === null) return "SEPI";
  if (mid.buyPct >= c.rame.beli) return "RAME BELI";
  if (mid.buyPct <= c.rame.jual) return "RAME JUAL";
  return "SEIMBANG";
}

export interface QualityConfig {
  minTrades: number;
  staleSec: number;
  lowQ: number;
}

/**
 * Kualitas data Q 0..100 (ESTIMASI bobot penalti):
 *  - trade sesi < minTrades: turun s/d 50 poin (proporsional)
 *  - update terakhir > staleSec: -40 ("DATA LAMA")
 *  - parser < 95%: -(95 - parser)
 */
export function quality(sessionTrades: number, lastTradeTs: number | null, now: number, parserPct: number | null, c: QualityConfig) {
  let q = 100;
  if (sessionTrades < c.minTrades) q -= 50 * (1 - sessionTrades / c.minTrades);
  const stale = lastTradeTs === null || now - lastTradeTs > c.staleSec * 1000;
  if (stale) q -= 40;
  if (parserPct !== null && parserPct < 95) q -= 95 - parserPct;
  q = Math.max(0, Math.min(100, Math.round(q)));
  const label = q < c.lowQ ? "DATA BELUM CUKUP" : stale ? "DATA LAMA" : null;
  return { q, stale, label } as const;
}

export function vwapLabel(dist: number | null, v: { dekat: number; wajar: number }): "DEKAT" | "WAJAR" | "TERLALU JAUH" | null {
  if (dist === null) return null;
  const a = Math.abs(dist);
  return a < v.dekat ? "DEKAT" : a <= v.wajar ? "WAJAR" : "TERLALU JAUH";
}
