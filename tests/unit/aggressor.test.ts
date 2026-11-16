import { describe, expect, it } from "vitest";
import { classifyAggressor, type TickState } from "../../src/core/aggressor";
import type { BookSnapshot } from "../../src/core/types";

function snap(ts: number, bid: number, offer: number): BookSnapshot {
  return {
    ts, code: "BBRI", bids: [{ price: bid, lot: 1000, freq: 10 }], offers: [{ price: offer, lot: 1000, freq: 10 }],
    prev: 0, open: 0, high: 0, low: 0, ara: 0, arb: 0, avg: 0, totalLot: 0, totalValue: 0,
  };
}

describe("aggressor", () => {
  const s = snap(10_000, 4000, 4010);

  it("label B/S dari layar diutamakan", () => {
    expect(classifyAggressor({ ts: 10_000, price: 4000, label: "B" }, s, {})).toEqual({ side: "BUY", method: "LABEL" });
  });
  it("HAKA: harga >= best offer", () => {
    expect(classifyAggressor({ ts: 10_500, price: 4010 }, s, {}).side).toBe("BUY");
    expect(classifyAggressor({ ts: 10_500, price: 4020 }, s, {}).method).toBe("QUOTE");
  });
  it("HAKI: harga <= best bid", () => {
    expect(classifyAggressor({ ts: 11_000, price: 4000 }, s, {})).toEqual({ side: "SELL", method: "QUOTE" });
  });
  it("di antara spread -> tick rule", () => {
    const wide = snap(10_000, 4000, 4030);
    const tick: TickState = { lastPrice: 4010, lastSide: "SELL" };
    expect(classifyAggressor({ ts: 10_100, price: 4020 }, wide, tick)).toEqual({ side: "BUY", method: "TICK" });
    expect(classifyAggressor({ ts: 10_200, price: 4010 }, wide, tick).side).toBe("SELL");
    expect(classifyAggressor({ ts: 10_300, price: 4010 }, wide, tick).side).toBe("SELL"); // sama -> sisi sebelumnya
  });
  it("snapshot basi (> 2 dtk) diabaikan", () => {
    const tick: TickState = { lastPrice: 3990 };
    expect(classifyAggressor({ ts: 13_000, price: 4000 }, s, tick)).toEqual({ side: "BUY", method: "TICK" });
  });
  it("tanpa snapshot & tanpa riwayat -> UNKNOWN", () => {
    const tick: TickState = {};
    expect(classifyAggressor({ ts: 1, price: 100 }, undefined, tick)).toEqual({ side: "UNKNOWN", method: "NONE" });
    expect(tick.lastPrice).toBe(100);
    expect(classifyAggressor({ ts: 2, price: 100 }, undefined, tick).side).toBe("UNKNOWN");
  });
});
