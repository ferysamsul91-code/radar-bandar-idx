import type { BookLevel, BookSnapshot } from "./types";

const sum = (xs: BookLevel[], k: "lot" | "freq") => xs.reduce((s, x) => s + x[k], 0);

/**
 * AQI = (bidLot/bidFreq) / (offerLot/offerFreq) dari level yang tampil.
 * > 1.5 = antrean beli lebih tebal per order. null jika data tidak cukup.
 */
export function aqi(snap: BookSnapshot, levels = Infinity): number | null {
  const b = snap.bids.slice(0, levels);
  const o = snap.offers.slice(0, levels);
  const bf = sum(b, "freq");
  const of = sum(o, "freq");
  const ol = sum(o, "lot");
  if (!bf || !of || !ol) return null;
  return sum(b, "lot") / bf / (ol / of);
}

/** Rasio total lot 5 bid teratas / 5 offer teratas. DEPTH SEHAT jika >= 0.8. */
export function depthRatio(snap: BookSnapshot, levels = 5): number | null {
  const ol = sum(snap.offers.slice(0, levels), "lot");
  return ol ? sum(snap.bids.slice(0, levels), "lot") / ol : null;
}

/** Net asing (Rupiah) dari F Buy - F Sell di widget. Sumber: Stockbit, akumulasi hari ini. */
export function foreignNet(snap: BookSnapshot): number | null {
  return snap.foreignBuy != null && snap.foreignSell != null ? snap.foreignBuy - snap.foreignSell : null;
}
