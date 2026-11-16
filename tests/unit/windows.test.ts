import { describe, expect, it } from "vitest";
import { RollingWindow, WindowSet, labelFor } from "../../src/core/windows";

const M = 1e6;

describe("windows", () => {
  it("label window", () => {
    expect([30, 180, 900, 3600].map(labelFor)).toEqual(["30s", "3m", "15m", "1h"]);
  });

  it("buyPct & aggrFlow 30s/3m/15m saat trade keluar window", () => {
    const ws = new WindowSet([30, 180, 900]);
    const t0 = 1_000_000;
    ws.addTrade(t0, "SELL", 300 * M); // t0
    ws.addTrade(t0 + 100_000, "BUY", 200 * M); // +100 dtk
    ws.addTrade(t0 + 170_000, "BUY", 100 * M); // +170 dtk
    ws.addTrade(t0 + 175_000, "SELL", 100 * M); // +175 dtk

    let m = ws.metrics(t0 + 175_000);
    expect(m["30s"]!.buyPct).toBeCloseTo(0.5); // 100 B vs 100 S
    expect(m["3m"]!.buyPct).toBeCloseTo(300 / 700);
    expect(m["3m"]!.aggrFlow).toBe(-100 * M);
    expect(m["15m"]!.trades).toBe(4);

    // +185 dtk: trade t0 keluar 3m; 30s tinggal trade +170 & +175
    m = ws.metrics(t0 + 185_000);
    expect(m["3m"]!.buyPct).toBeCloseTo(300 / 400);
    expect(m["3m"]!.aggrFlow).toBe(200 * M);
    expect(m["30s"]!.trades).toBe(2);

    // +206 dtk: 30s kosong -> buyPct null
    m = ws.metrics(t0 + 206_000);
    expect(m["30s"]!.buyPct).toBeNull();
    expect(m["30s"]!.aggrFlow).toBe(0);
    expect(m["15m"]!.aggrFlow).toBe(-100 * M);
    expect(m["sesi"]!.trades).toBe(4);
  });

  it("batas window: entri tepat di now-duration sudah keluar", () => {
    const w = new RollingWindow(30_000);
    w.addTrade(0, "BUY", 1);
    expect(w.metrics(29_999).trades).toBe(1);
    expect(w.metrics(30_000).trades).toBe(0);
  });

  it("lot besar: bigBuy/bigSell/bigNet/bigShare", () => {
    const w = new RollingWindow(180_000);
    w.addTrade(0, "BUY", 600 * M);
    w.addBig(0, "BUY", 600 * M);
    w.addTrade(1000, "SELL", 300 * M);
    w.addBig(1000, "SELL", 300 * M);
    w.addTrade(2000, "UNKNOWN", 100 * M);
    w.addBig(2000, "UNKNOWN", 999 * M); // diabaikan
    const m = w.metrics(2000);
    expect(m.bigNet).toBe(300 * M);
    expect(m.bigShare).toBeCloseTo(0.9);
    expect(m.trades).toBe(3);
    expect(m.unknownValue).toBe(100 * M);
    expect(m.buyPct).toBeCloseTo(600 / 900);
  });

  it("window sesi tidak pernah evict, reset manual", () => {
    const ws = new WindowSet([30]);
    ws.addTrade(0, "BUY", 5);
    expect(ws.metrics(10 * 3600_000)["sesi"]!.aggrFlow).toBe(5);
    ws.resetSession();
    expect(ws.metrics(0)["sesi"]!.trades).toBe(0);
  });

  it("banyak trade tetap konsisten setelah pemadatan array", () => {
    const w = new RollingWindow(1000);
    for (let i = 0; i < 5000; i++) w.addTrade(i * 10, i % 2 ? "BUY" : "SELL", 1);
    const m = w.metrics(49_990);
    expect(m.trades).toBe(100);
    expect(m.aggrFlow).toBe(0);
  });
});
