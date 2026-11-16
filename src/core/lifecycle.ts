/**
 * Lifecycle level bid/offer tebal dari snapshot orderbook + trade di antaranya.
 *
 * Level "tebal" = lot >= max(minBigLot, thickVsMedian x median lot level yang tampil di sisi itu).
 * Saat lot level tebal berkurang/hilang, dicek apakah pengurangan itu dijelaskan oleh trade
 * di harga tersebut sejak snapshot sebelumnya:
 *   - bid berkurang & ada trade SELL di harga itu  -> BID TERUJI (masih tebal) / BID DIMAKAN (habis)
 *   - bid hilang tanpa trade                       -> BID DITARIK (cancel, risiko)
 *   - offer habis oleh trade BUY                   -> OFFER DIMAKAN (konfirmasi HAKA)
 *   - level tebal muncul lagi di harga yang baru dimakan -> REFILL (iceberg/distribusi)
 *   - bid tebal bertahan >= holdSec                -> BID BERTAHAN
 * Semua parameter ESTIMASI awal (thresholds.json -> lifecycle).
 */
import type { BookLevel, BookSnapshot, Side } from "./types";

export interface LifecycleConfig {
  levels: number;
  thickVsMedian: number;
  holdSec: number;
  eventTtlSec: number;
  refillWindowSec: number;
  tradeExplainRatio: number;
}

export type LcType =
  | "BID BERTAHAN" | "BID TERUJI" | "BID DIMAKAN" | "BID DITARIK"
  | "OFFER DIMAKAN" | "OFFER TERUJI" | "OFFER DITARIK" | "REFILL";

export interface LcEvent {
  type: LcType;
  side: "bid" | "offer";
  price: number;
  lot: number;
  ts: number;
}

interface Tracked {
  side: "bid" | "offer";
  price: number;
  lot: number;
  firstSeen: number;
  heldEmitted: boolean;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export class LifecycleTracker {
  private tracked = new Map<string, Tracked>();
  private traded = new Map<number, { buy: number; sell: number }>();
  private eatenAt = new Map<string, number>();
  private events: LcEvent[] = [];
  private lastSnap: BookSnapshot | null = null;

  constructor(private cfg: LifecycleConfig) {}

  addTrade(price: number, lot: number, side: Side): void {
    const t = this.traded.get(price) ?? { buy: 0, sell: 0 };
    if (side === "BUY") t.buy += lot;
    else if (side === "SELL") t.sell += lot;
    this.traded.set(price, t);
  }

  thickThreshold(levels: BookLevel[], minBigLot: number): number {
    return Math.max(minBigLot, this.cfg.thickVsMedian * median(levels.map((l) => l.lot)));
  }

  onSnapshot(snap: BookSnapshot, minBigLot: number): void {
    const now = snap.ts;
    for (const side of ["bid", "offer"] as const) {
      const all = side === "bid" ? snap.bids : snap.offers;
      if (!all.length) continue;
      const lotAt = new Map(all.map((l) => [l.price, l.lot]));
      const prices = all.map((l) => l.price);
      const minP = Math.min(...prices);
      const maxP = Math.max(...prices);
      const thr = this.thickThreshold(all, minBigLot);

      for (const [key, tr] of this.tracked) {
        if (tr.side !== side) continue;
        // Keluar dari jangkauan tampilan (bukan cancel): berhenti dilacak.
        if ((side === "bid" && tr.price < minP) || (side === "offer" && tr.price > maxP)) {
          this.tracked.delete(key);
          continue;
        }
        const cur = lotAt.get(tr.price) ?? 0;
        const drop = tr.lot - cur;
        const t = this.traded.get(tr.price);
        const hit = side === "bid" ? t?.sell ?? 0 : t?.buy ?? 0; // bid dimakan oleh SELL, offer oleh BUY
        const explained = drop > 0 && hit >= this.cfg.tradeExplainRatio * drop;
        if (cur < thr) {
          if (drop > 0) {
            const type: LcType = explained
              ? side === "bid" ? "BID DIMAKAN" : "OFFER DIMAKAN"
              : side === "bid" ? "BID DITARIK" : "OFFER DITARIK";
            this.push({ type, side, price: tr.price, lot: tr.lot, ts: now });
            if (explained) this.eatenAt.set(key, now);
          }
          this.tracked.delete(key);
          continue;
        }
        if (explained) this.push({ type: side === "bid" ? "BID TERUJI" : "OFFER TERUJI", side, price: tr.price, lot: drop, ts: now });
        tr.lot = cur;
        if (side === "bid" && !tr.heldEmitted && now - tr.firstSeen >= this.cfg.holdSec * 1000) {
          tr.heldEmitted = true;
          this.push({ type: "BID BERTAHAN", side, price: tr.price, lot: cur, ts: now });
        }
      }

      for (const lv of all.slice(0, this.cfg.levels)) {
        const key = `${side}|${lv.price}`;
        if (lv.lot < thr || this.tracked.has(key)) continue;
        const eaten = this.eatenAt.get(key);
        if (eaten !== undefined && now - eaten <= this.cfg.refillWindowSec * 1000) {
          this.push({ type: "REFILL", side, price: lv.price, lot: lv.lot, ts: now });
          this.eatenAt.delete(key);
        }
        this.tracked.set(key, { side, price: lv.price, lot: lv.lot, firstSeen: now, heldEmitted: false });
      }
    }
    this.traded.clear();
    this.lastSnap = snap;
  }

  private push(e: LcEvent): void {
    this.events.push(e);
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
  }

  /** Event dalam eventTtlSec terakhir (terbaru di akhir). */
  recent(now: number): LcEvent[] {
    const cut = now - this.cfg.eventTtlSec * 1000;
    return this.events.filter((e) => e.ts > cut);
  }

  /** Bid tebal yang saat ini sudah bertahan >= holdSec. */
  bidHolding(now: number): boolean {
    for (const t of this.tracked.values()) {
      if (t.side === "bid" && now - t.firstSeen >= this.cfg.holdSec * 1000) return true;
    }
    return false;
  }

  flags(now: number) {
    const r = this.recent(now);
    const has = (type: LcType, side?: "bid" | "offer") => r.some((e) => e.type === type && (!side || e.side === side));
    return {
      bidBertahan: this.bidHolding(now),
      bidDitarik: has("BID DITARIK"),
      offerDimakan: has("OFFER DIMAKAN"),
      refillOffer: has("REFILL", "offer"),
      refillBid: has("REFILL", "bid"),
    };
  }

  /** Skor lifecycle 0..1 (ESTIMASI). depthSehat dari depthRatio >= 0.8. */
  score(now: number, depthSehat: boolean): number {
    const f = this.flags(now);
    let s = 0.5;
    if (f.bidBertahan) s += 0.2;
    if (f.offerDimakan) s += 0.2;
    if (depthSehat) s += 0.1;
    if (f.bidDitarik) s -= 0.3;
    if (f.refillOffer) s -= 0.2;
    return Math.max(0, Math.min(1, s));
  }

  get snapshot(): BookSnapshot | null {
    return this.lastSnap;
  }
}
