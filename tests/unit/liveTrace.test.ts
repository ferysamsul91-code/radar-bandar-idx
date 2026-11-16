import { describe, expect, it } from "vitest";
import { DEFAULT_LIVE_TRACE, LiveTraceTracker } from "../../src/core/liveTrace";
import type { Trade } from "../../src/core/types";

const T0 = Date.UTC(2026, 10, 16, 2, 40, 0); // 09:40 WIB
let n = 0;
/** Harga 1.000: 1.000 lot = Rp100 jt. Tanpa broker (sesi live). */
const tr = (sec: number, lot: number, side: "BUY" | "SELL", code = "BBCA", extra: Partial<Trade> = {}): Trade =>
  ({ ts: T0 + sec * 1000, code, price: 1000, lot, value: 1000 * lot * 100, side, board: "RG", hash: String(n++), ...extra });

describe("POLA LOT BESAR LIVE (tanpa broker)", () => {
  it("ASING: F Buy naik >= 50% nilai rangkaian", () => {
    const k = new LiveTraceTracker(DEFAULT_LIVE_TRACE);
    k.onForeign("BBCA", T0, 100e9, 80e9);
    k.add(tr(0, 4000, "BUY"));
    k.add(tr(30, 4000, "BUY"));
    k.onForeign("BBCA", T0 + 40_000, 100.9e9, 80e9);
    const e = k.add(tr(60, 4000, "BUY"))!; // total Rp1,2 M
    expect(e).toMatchObject({ code: "BBCA", side: "BELI", trades: 3, lot: 12000, value: 1.2e9, category: "ASING" });
    expect(e.foreignDelta).toBeCloseTo(0.9e9, -3);
    expect(e.foreignShare).toBeCloseTo(0.75, 5);
  });
  it("INSTITUSI/LOKAL: lot besar beruntun tetapi F Buy tidak ikut naik", () => {
    const k = new LiveTraceTracker(DEFAULT_LIVE_TRACE);
    k.onForeign("BBCA", T0, 100e9, 80e9);
    for (let i = 0; i < 3; i++) k.add(tr(i * 20, 5000, "BUY"));
    k.onForeign("BBCA", T0 + 70_000, 100.1e9, 80e9);
    expect(k.events[0]).toMatchObject({ category: "INSTITUSI/LOKAL", value: 1.5e9 });
    expect(k.events[0]!.foreignShare).toBeCloseTo(0.1 / 1.5, 5);
  });
  it("? bila emiten tanpa widget orderbook; JUAL memakai F Sell", () => {
    const k = new LiveTraceTracker(DEFAULT_LIVE_TRACE);
    for (let i = 0; i < 3; i++) k.add(tr(i, 5000, "SELL", "GOTO"));
    expect(k.events[0]).toMatchObject({ code: "GOTO", side: "JUAL", category: "?", foreignShare: null });
    k.onForeign("TLKM", T0, 50e9, 60e9);
    for (let i = 0; i < 3; i++) k.add(tr(i, 5000, "SELL", "TLKM"));
    k.onForeign("TLKM", T0 + 5_000, 52e9, 61.2e9); // F Buy naik tak relevan; F Sell naik 1,2 M
    expect(k.events[0]).toMatchObject({ code: "TLKM", side: "JUAL", category: "ASING" });
  });
  it("trade kecil, NG, jeda > 5 menit tidak membentuk rangkaian; update tanpa duplikat", () => {
    const k = new LiveTraceTracker(DEFAULT_LIVE_TRACE);
    for (let i = 0; i < 20; i++) k.add(tr(i, 900, "BUY")); // Rp90 jt per trade
    for (let i = 0; i < 5; i++) k.add(tr(i, 9000, "BUY", "BBCA", { board: "NG" }));
    k.add(tr(0, 5000, "BUY", "ASII"));
    k.add(tr(10, 5000, "BUY", "ASII"));
    k.add(tr(10 + 301, 5000, "BUY", "ASII"));
    expect(k.events).toEqual([]);
    for (let i = 0; i < 6; i++) k.add(tr(400 + i * 10, 5000, "BUY", "ASII"));
    expect(k.events).toHaveLength(1);
    expect(k.events[0]).toMatchObject({ trades: 7, value: 3.5e9 }); // termasuk trade ke-3 (311 dtk) sebagai awal rangkaian baru
    expect(k.isActive(k.events[0]!, T0 + 450_000 + 299_000)).toBe(true);
  });
  it("ringkasan per emiten", () => {
    const k = new LiveTraceTracker(DEFAULT_LIVE_TRACE);
    k.onForeign("BBCA", T0, 0, 0);
    for (let i = 0; i < 3; i++) k.add(tr(i, 5000, "BUY"));
    k.onForeign("BBCA", T0 + 5000, 1.5e9, 0);
    for (let i = 0; i < 3; i++) k.add(tr(100 + i, 4000, "SELL"));
    expect(k.summary()[0]).toMatchObject({ code: "BBCA", buy: 1.5e9, sell: 1.2e9, asingBuy: 1.5e9, asingSell: 0, instBuy: 0, instSell: 1.2e9, runs: 2, instRuns: 1 });
  });
});
