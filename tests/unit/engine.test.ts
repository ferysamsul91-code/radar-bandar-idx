/**
 * 10 skenario end-to-end mesin per emiten (data sintetis, harga 1.000, mode scalping).
 * Ambang lot besar awal di harga 1.000 = max(500, ceil(250 jt / 100.000) = 2.500) = 2.500 lot.
 */
import { describe, expect, it } from "vitest";
import brokers from "../../src/config/brokers.json";
import thresholds from "../../src/config/thresholds.json";
import { BrokerMap } from "../../src/core/brokerMap";
import { RadarEngine, type Thresholds } from "../../src/core/engine";
import type { BookLevel, BookSnapshot, Side, Trade } from "../../src/core/types";

const cfg = thresholds as unknown as Thresholds;
const bm = new BrokerMap(brokers);
const S = 1000;
const T0 = Date.UTC(2026, 10, 13, 3, 0, 0); // 10:00 WIB

let n = 0;
function tr(sec: number, lot: number, side: Side, extra: Partial<Trade> = {}): Trade {
  const price = extra.price ?? 1000;
  return { ts: T0 + sec * S, code: "TEST", price, lot, value: price * lot * 100, side, board: "RG", hash: String(n++), ...extra };
}
function snap(sec: number, bids: [number, number][]): BookSnapshot {
  const lv = (xs: [number, number][]): BookLevel[] => xs.map(([price, lot]) => ({ price, lot, freq: 10 }));
  return {
    ts: T0 + sec * S, code: "TEST", bids: lv(bids), offers: lv([[1005, 4000], [1010, 4000], [1015, 4000], [1020, 4000], [1025, 4000]]),
    prev: null, open: null, high: null, low: null, ara: null, arb: null, avg: null, totalLot: null, totalValue: null, last: 1000,
  };
}
const THICK_BID: [number, number][] = [[1000, 5000], [995, 60000], [990, 5000], [985, 5000], [980, 5000]];
const PULLED_BID: [number, number][] = [[1000, 5000], [995, 1000], [990, 5000], [985, 5000], [980, 5000]];

/** Akumulasi: tiap 5 dtk BUY 3.000 lot (lot besar) + SELL 100 lot, selama 180 dtk. */
function accumulation(e: RadarEngine, withBroker: boolean) {
  for (let s = 0; s < 180; s += 5) {
    e.ingestTrade(tr(s, 3000, "BUY", withBroker ? { buyerBroker: "AK", buyerType: "F", sellerBroker: "XL", sellerType: "D" } : {}));
    e.ingestTrade(tr(s + 1, 100, "SELL", withBroker ? { buyerBroker: "XL", buyerType: "D", sellerBroker: "YP", sellerType: "D" } : {}));
  }
}
const view = (e: RadarEngine, sec: number, parser: number | null = 100) => e.views(T0 + sec * S, parser).find((v) => v.code === "TEST")!;

describe("skenario engine", () => {
  it("1. akumulasi -> FLOW KUAT, skor A, ★1", () => {
    const e = new RadarEngine(cfg, "scalping", bm);
    accumulation(e, false);
    const v = view(e, 180);
    expect(v.status).toBe("FLOW KUAT");
    expect(v.m.mid.buyPct!).toBeGreaterThan(0.95);
    expect(v.m.mid.bigNet).toBeGreaterThan(0);
    expect(v.score.score).toBeGreaterThanOrEqual(80);
    expect(v.stars).toBe(1);
    expect(v.rame).toBe("RAME BELI");
  });

  it("2. distribusi -> PADA JUALAN, skor rendah", () => {
    const e = new RadarEngine(cfg, "scalping", bm);
    for (let s = 0; s < 180; s += 5) {
      e.ingestTrade(tr(s, 3000, "SELL"));
      e.ingestTrade(tr(s + 1, 100, "BUY"));
    }
    const v = view(e, 180);
    expect(v.status).toBe("PADA JUALAN");
    expect(v.score.score).toBeLessThan(40);
    expect(v.rame).toBe("RAME JUAL");
  });

  it("3. pump singkat 30 dtk -> PADA BELI (bukan FLOW KUAT)", () => {
    const e = new RadarEngine(cfg, "scalping", bm);
    for (let s = 0; s < 150; s += 5) e.ingestTrade(tr(s, 2000, "SELL"));
    for (let s = 155; s < 180; s += 5) e.ingestTrade(tr(s, 3000, "BUY"));
    const v = view(e, 180);
    expect(v.status).toBe("PADA BELI");
    expect(v.m.short.buyPct).toBe(1);
    expect(v.m.mid.buyPct!).toBeLessThan(0.75);
  });

  it("4. data lama -> NETRAL + DATA LAMA, Q turun", () => {
    const e = new RadarEngine(cfg, "scalping", bm);
    accumulation(e, false);
    const v = view(e, 180 + 600);
    expect(v.status).toBe("NETRAL");
    expect(v.qLabel).toBe("DATA LAMA");
    expect(v.q).toBe(60);
  });

  it("5. broker tidak tampil -> party null, skor lebih rendah dari versi dengan broker asing beli", () => {
    const a = new RadarEngine(cfg, "scalping", bm);
    accumulation(a, false);
    const b = new RadarEngine(cfg, "scalping", bm);
    accumulation(b, true);
    const va = view(a, 180);
    const vb = view(b, 180);
    expect(va.party).toBeNull();
    expect(vb.party!.foreign).toBeGreaterThan(0);
    expect(vb.party!.retail).toBeLessThanOrEqual(0);
    expect(vb.score.score).toBeGreaterThan(va.score.score);
    expect(vb.score.grade).toBe("A+");
  });

  it("6. trade NG/TN diabaikan untuk sinyal", () => {
    const e = new RadarEngine(cfg, "scalping", bm);
    for (let s = 0; s < 60; s++) e.ingestTrade(tr(s, 50000, "BUY", { board: "NG" }));
    expect(e.views(T0 + 60 * S, 100)).toEqual([]);
  });

  it("7. split order 5 x 600 lot -> 1 lot besar (cluster)", () => {
    const e = new RadarEngine(cfg, "scalping", bm);
    for (let i = 0; i < 5; i++) e.ingestTrade(tr(i, 600, "BUY", { buyerBroker: "AK" }));
    expect(e.recentBig).toHaveLength(1);
    expect(e.recentBig[0]).toMatchObject({ lot: 3000, trades: 5, value: 300_000_000, side: "BUY" });
    expect(view(e, 5).m.short.bigBuy).toBe(300_000_000);
    // cluster berlanjut: tetap 1 baris, nilai total bertambah, window hanya ditambah inkremen
    for (let i = 5; i < 10; i++) e.ingestTrade(tr(i, 600, "BUY", { buyerBroker: "AK" }));
    expect(e.recentBig).toHaveLength(1);
    expect(e.recentBig[0]).toMatchObject({ lot: 6000, trades: 10, clusterValue: 600_000_000 });
    expect(view(e, 10).m.short.bigBuy).toBe(600_000_000);
  });

  it("8. akumulasi diam-diam -> CUAN MENANTI (bid bertahan, harga di VWAP)", () => {
    const e = new RadarEngine(cfg, "scalping", bm);
    for (let s = 0; s <= 600; s += 5) {
      e.ingestSnapshot(snap(s, THICK_BID));
      if (s % 10 === 0) {
        e.ingestTrade(tr(s, 200, "BUY"));
        e.ingestTrade(tr(s + 1, 100, "SELL"));
      }
    }
    const v = view(e, 601);
    expect(v.flags.bidBertahan).toBe(true);
    expect(v.status).toBe("CUAN MENANTI");
    expect(v.vwapLabel).toBe("DEKAT");
  });

  it("9. pergantian sisi BELI -> JUAL terkonfirmasi", () => {
    const e = new RadarEngine(cfg, "scalping", bm);
    for (let s = 0; s <= 60; s += 5) {
      e.ingestTrade(tr(s, 3000, "BUY"));
      view(e, s);
    }
    expect(e.get("TEST").sc.side).toBe("BELI");
    for (let s = 62; s <= 150; s += 2) {
      e.ingestTrade(tr(s, 10000, "SELL"));
      view(e, s);
    }
    const v = view(e, 150);
    expect(v.status).toBe("PADA JUALAN");
    expect(v.sideChange).toMatchObject({ from: "BELI", to: "JUAL" });
  });

  it("10. penalti BID DITARIK menurunkan skor >= 15", () => {
    const run = (pull: boolean) => {
      const e = new RadarEngine(cfg, "scalping", bm);
      accumulation(e, false);
      e.ingestSnapshot(snap(175, THICK_BID));
      e.ingestSnapshot(snap(178, pull ? PULLED_BID : THICK_BID));
      return view(e, 179);
    };
    const keep = run(false);
    const pulled = run(true);
    expect(pulled.flags.bidDitarik).toBe(true);
    expect(pulled.lifecycle.map((x) => x.type)).toContain("BID DITARIK");
    expect(keep.score.score - pulled.score.score).toBeGreaterThanOrEqual(15);
  });
});
