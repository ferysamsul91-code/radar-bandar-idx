import { describe, expect, it } from "vitest";
import thresholds from "../../src/config/thresholds.json";
import { LifecycleTracker, type LifecycleConfig } from "../../src/core/lifecycle";
import type { BookLevel, BookSnapshot } from "../../src/core/types";

const cfg = thresholds.lifecycle as LifecycleConfig;
const S = 1000;

function snap(ts: number, bids: [number, number][], offers: [number, number][]): BookSnapshot {
  const lv = (xs: [number, number][]): BookLevel[] => xs.map(([price, lot]) => ({ price, lot, freq: 10 }));
  return {
    ts, code: "TEST", bids: lv(bids), offers: lv(offers), prev: null, open: null, high: null, low: null,
    ara: null, arb: null, avg: null, totalLot: null, totalValue: null,
  };
}
// Bid tebal 50.000 lot di 1.000 (median lain 5.000 -> ambang 10.000)
const BIDS: [number, number][] = [[1000, 50000], [995, 5000], [990, 5000], [985, 5000], [980, 5000]];
const OFFERS: [number, number][] = [[1005, 40000], [1010, 4000], [1015, 4000], [1020, 4000], [1025, 4000]];

describe("lifecycle bid/offer", () => {
  it("BID DITARIK: bid tebal hilang tanpa trade di harga itu", () => {
    const lc = new LifecycleTracker(cfg);
    lc.onSnapshot(snap(0, BIDS, OFFERS), 1000);
    lc.onSnapshot(snap(1 * S, [[1000, 2000], ...BIDS.slice(1)], OFFERS), 1000);
    expect(lc.recent(1 * S).map((e) => e.type)).toEqual(["BID DITARIK"]);
    expect(lc.flags(1 * S).bidDitarik).toBe(true);
  });

  it("BID DIMAKAN: bid tebal hilang karena trade SELL (bukan ditarik)", () => {
    const lc = new LifecycleTracker(cfg);
    lc.onSnapshot(snap(0, BIDS, OFFERS), 1000);
    lc.addTrade(1000, 48000, "SELL");
    lc.onSnapshot(snap(1 * S, [[1000, 2000], ...BIDS.slice(1)], OFFERS), 1000);
    expect(lc.recent(1 * S).map((e) => e.type)).toEqual(["BID DIMAKAN"]);
    expect(lc.flags(1 * S).bidDitarik).toBe(false);
  });

  it("BID TERUJI: dimakan sebagian tapi masih tebal", () => {
    const lc = new LifecycleTracker(cfg);
    lc.onSnapshot(snap(0, BIDS, OFFERS), 1000);
    lc.addTrade(1000, 20000, "SELL");
    lc.onSnapshot(snap(1 * S, [[1000, 30000], ...BIDS.slice(1)], OFFERS), 1000);
    expect(lc.recent(1 * S).map((e) => e.type)).toEqual(["BID TERUJI"]);
  });

  it("BID BERTAHAN setelah >= 30 dtk", () => {
    const lc = new LifecycleTracker(cfg);
    for (let t = 0; t <= 30; t += 5) lc.onSnapshot(snap(t * S, BIDS, OFFERS), 1000);
    expect(lc.flags(30 * S).bidBertahan).toBe(true);
    expect(lc.recent(30 * S).filter((e) => e.type === "BID BERTAHAN")).toHaveLength(1);
    const lc2 = new LifecycleTracker(cfg);
    for (let t = 0; t <= 25; t += 5) lc2.onSnapshot(snap(t * S, BIDS, OFFERS), 1000);
    expect(lc2.flags(25 * S).bidBertahan).toBe(false);
  });

  it("OFFER DIMAKAN lalu REFILL di harga sama", () => {
    const lc = new LifecycleTracker(cfg);
    lc.onSnapshot(snap(0, BIDS, OFFERS), 1000);
    lc.addTrade(1005, 40000, "BUY");
    lc.onSnapshot(snap(1 * S, BIDS, OFFERS.slice(1)), 1000);
    expect(lc.flags(1 * S).offerDimakan).toBe(true);
    lc.onSnapshot(snap(5 * S, BIDS, OFFERS), 1000); // offer 40.000 muncul lagi
    expect(lc.recent(5 * S).map((e) => e.type)).toEqual(["OFFER DIMAKAN", "REFILL"]);
    expect(lc.flags(5 * S).refillOffer).toBe(true);
  });

  it("level keluar jangkauan tampilan tidak dianggap ditarik", () => {
    const lc = new LifecycleTracker(cfg);
    lc.onSnapshot(snap(0, BIDS, OFFERS), 1000);
    // harga naik: semua bid baru di atas 1.000, level 1.000 tidak tampil lagi
    lc.onSnapshot(snap(1 * S, [[1050, 5000], [1045, 5000], [1040, 5000], [1035, 5000], [1030, 5000]], OFFERS), 1000);
    expect(lc.recent(1 * S)).toEqual([]);
  });

  it("event kedaluwarsa setelah 60 dtk; skor lifecycle naik/turun", () => {
    const lc = new LifecycleTracker(cfg);
    lc.onSnapshot(snap(0, BIDS, OFFERS), 1000);
    lc.onSnapshot(snap(1 * S, [[1000, 2000], ...BIDS.slice(1)], OFFERS), 1000);
    expect(lc.score(1 * S, false)).toBeCloseTo(0.2);
    expect(lc.recent(62 * S)).toEqual([]);
    expect(lc.score(62 * S, true)).toBeCloseTo(0.6);
  });
});
