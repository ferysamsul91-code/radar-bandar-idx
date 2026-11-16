import type { BookSnapshot, Side } from "./types";

export type AggressorMethod = "LABEL" | "QUOTE" | "TICK" | "NONE";

export interface AggressorInput {
  ts: number;
  price: number;
  /** Label B/S dari layar (warna/teks running trade), jika ada. */
  label?: "B" | "S" | null;
}

/** State tick rule per emiten. */
export interface TickState {
  lastPrice?: number;
  lastSide?: Side;
}

export interface AggressorResult {
  side: Side;
  method: AggressorMethod;
}

/**
 * Tentukan sisi agresor:
 * 1) label B/S dari layar
 * 2) banding best bid/offer snapshot (umur <= maxSnapAgeMs): >= offer = BUY (HAKA), <= bid = SELL (HAKI)
 * 3) tick rule: naik = BUY, turun = SELL, sama = sisi sebelumnya
 * State `tick` diperbarui di tempat.
 */
export function classifyAggressor(
  t: AggressorInput,
  snap: BookSnapshot | undefined,
  tick: TickState,
  maxSnapAgeMs = 2000,
): AggressorResult {
  let res: AggressorResult = { side: "UNKNOWN", method: "NONE" };

  if (t.label === "B" || t.label === "S") {
    res = { side: t.label === "B" ? "BUY" : "SELL", method: "LABEL" };
  } else {
    const fresh = snap && Math.abs(t.ts - snap.ts) <= maxSnapAgeMs;
    const bestBid = fresh ? snap.bids[0]?.price : undefined;
    const bestOffer = fresh ? snap.offers[0]?.price : undefined;
    if (bestOffer !== undefined && t.price >= bestOffer) res = { side: "BUY", method: "QUOTE" };
    else if (bestBid !== undefined && t.price <= bestBid) res = { side: "SELL", method: "QUOTE" };
    else if (tick.lastPrice !== undefined) {
      if (t.price > tick.lastPrice) res = { side: "BUY", method: "TICK" };
      else if (t.price < tick.lastPrice) res = { side: "SELL", method: "TICK" };
      else if (tick.lastSide && tick.lastSide !== "UNKNOWN") res = { side: tick.lastSide, method: "TICK" };
    }
  }

  tick.lastPrice = t.price;
  if (res.side !== "UNKNOWN") tick.lastSide = res.side;
  return res;
}
