// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSymbol, DEFAULT_DIV, findDivergences, pickOscillator, rsi } from "../../src/core/divergence";
import { parseChartTable, type ChartBar } from "../../src/content/parse-chartbit";

/** Bar sintetis: low/high = close ∓ 5. */
const mk = (closes: number[]): ChartBar[] => closes.map((c, i) => ({ t: `2026-01-${String(i + 1).padStart(2, "0")}`, o: c, h: c + 5, l: c - 5, c, ind: {} }));
const cfg = { ...DEFAULT_DIV, left: 2, right: 2, minRange: 3, maxRange: 30 };

describe("divergence: 4 jenis (data sintetis)", () => {
  // dasar di indeks 3 dan 9; puncak di 6 dan 12 (lookback 2)
  const base = [110, 105, 100, 90, 100, 110, 130, 115, 105, 95, 105, 115, 135, 120, 110];
  it("BULLISH: harga lower low, osilator higher low", () => {
    const price = base.map((v, i) => (i === 9 ? 85 : v)); // dasar ke-2 lebih rendah
    const osc = base.map((_, i) => (i === 3 ? 20 : i === 9 ? 30 : 50));
    const s = findDivergences(mk(price), osc, cfg).filter((x) => x.type === "BULLISH");
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ p1: { t: "2026-01-04", price: 85, osc: 20 }, p2: { t: "2026-01-10", price: 80, osc: 30 }, barsAgo: 5 });
  });
  it("HIDDEN BULLISH: harga higher low, osilator lower low", () => {
    const osc = base.map((_, i) => (i === 3 ? 30 : i === 9 ? 20 : 50));
    expect(findDivergences(mk(base), osc, cfg).map((x) => x.type)).toContain("HIDDEN BULLISH");
  });
  it("BEARISH: harga higher high, osilator lower high", () => {
    const osc = base.map((_, i) => (i === 6 ? 80 : i === 12 ? 70 : 50));
    const s = findDivergences(mk(base), osc, cfg).find((x) => x.type === "BEARISH")!;
    expect(s).toMatchObject({ p1: { price: 135, osc: 80 }, p2: { price: 140, osc: 70 }, barsAgo: 2 });
  });
  it("HIDDEN BEARISH: harga lower high, osilator higher high", () => {
    const price = base.map((v, i) => (i === 12 ? 125 : v));
    const osc = base.map((_, i) => (i === 6 ? 70 : i === 12 ? 80 : 50));
    expect(findDivergences(mk(price), osc, cfg).map((x) => x.type)).toContain("HIDDEN BEARISH");
  });
  it("tanpa divergence bila searah; jarak di luar rentang diabaikan", () => {
    const osc = base.map((_, i) => (i === 3 ? 20 : i === 9 ? 25 : i === 6 ? 70 : i === 12 ? 80 : 50));
    expect(findDivergences(mk(base), osc, cfg)).toEqual([]); // harga HL & osc HL, harga HH & osc HH
    const far = findDivergences(mk(base.map((v, i) => (i === 9 ? 85 : v))), base.map((_, i) => (i === 3 ? 20 : i === 9 ? 30 : 50)), { ...cfg, maxRange: 5 });
    expect(far.filter((x) => x.type === "BULLISH")).toEqual([]);
  });
});

describe("osilator", () => {
  it("pilihan otomatis: RSI > Stoch RSI %K > MACD > RSI dihitung", () => {
    expect(pickOscillator(["Stoch RSI 14 14 3 3|%K", "RSI 14 close|RSI"]).key).toBe("RSI 14 close|RSI");
    expect(pickOscillator(["Stoch RSI 14 14 3 3|%K", "Stoch RSI 14 14 3 3|%D"]).key).toBe("Stoch RSI 14 14 3 3|%K");
    expect(pickOscillator(["MACD 12 26 close 9|Histogram", "MACD 12 26 close 9|MACD"]).key).toBe("MACD 12 26 close 9|MACD");
    expect(pickOscillator([]).label).toBe("RSI 14 (dihitung radar)");
    expect(pickOscillator(["Stoch RSI 14 14 3 3|%K"], "rsi-calc").key).toBeNull();
  });
  it("RSI Wilder", () => {
    const r = rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 14]);
    expect(r[13]).toBeNull();
    expect(r[14]).toBe(100);
    expect(r[15]!).toBeCloseTo(100 - 100 / (1 + 13 / 14 / (1 / 14)), 6);
  });
});

describe("MEDC 1D + Stoch RSI (fixture asli 39 candle)", () => {
  document.body.innerHTML = readFileSync(resolve(import.meta.dirname, "../../fixtures/chartbit-table-medc.html"), "utf8");
  const p = parseChartTable(document);
  it("memakai Stoch RSI %K; sinyal konsisten dengan definisi", () => {
    const a = analyzeSymbol("MEDC", "1D", p.bars, { ...DEFAULT_DIV, oscillator: "auto" });
    expect(a).toMatchObject({ symbol: "MEDC", bars: 39, lastT: "2026-11-13", oscLabel: "Stoch RSI 14 14 3 3 %K" });
    for (const s of Object.values(a.latest)) {
      const lowSide = s!.type.includes("BULLISH");
      const priceUp = s!.p2.price > s!.p1.price;
      const oscUp = s!.p2.osc > s!.p1.osc;
      if (s!.type === "BULLISH") expect([priceUp, oscUp]).toEqual([false, true]);
      if (s!.type === "HIDDEN BULLISH") expect([priceUp, oscUp]).toEqual([true, false]);
      if (s!.type === "BEARISH") expect([priceUp, oscUp]).toEqual([true, false]);
      if (s!.type === "HIDDEN BEARISH") expect([priceUp, oscUp]).toEqual([false, true]);
      expect(lowSide ? "low" : "high").toBeTruthy();
    }
  });
});

import { chartKey, mergeBars } from "../../src/core/chartStore";
describe("simpanan candle Chartbit", () => {
  const b = (t: string, c: number) => ({ t, o: c, h: c, l: c, c, ind: { "X|K": c } });
  it("gabung per tanggal, urut lama -> baru, tanpa perubahan -> null", () => {
    const s1 = mergeBars(undefined, "MEDC", "1D", [b("2026-11-13", 3), b("2026-11-12", 2)], 1)!;
    expect(s1.bars.map((x) => x.t)).toEqual(["2026-11-12", "2026-11-13"]);
    expect(mergeBars(s1, "MEDC", "1D", [b("2026-11-13", 3)], 2)).toBeNull();
    const s2 = mergeBars(s1, "MEDC", "1D", [b("2026-11-11", 1), b("2026-11-13", 4)], 3)!;
    expect(s2.bars.map((x) => `${x.t}:${x.c}`)).toEqual(["2026-11-11:1", "2026-11-12:2", "2026-11-13:4"]);
    expect(chartKey("MEDC", "1D")).toBe("rbChart:MEDC:1D");
  });
});

import { chartbitUrl, normalizeScanList, scanProgress } from "../../src/core/scanList";
describe("RSI 14 & daftar pindai", () => {
  it("osilator bawaan RSI: kolom garis RSI, bukan RSI-based MA; tanpa RSI -> dihitung", () => {
    const keys = ["Stoch RSI 14 14 3 3|%K", "RSI 14 close|RSI-based MA", "RSI 14 close|RSI"];
    expect(pickOscillator(keys, DEFAULT_DIV.oscillator).key).toBe("RSI 14 close|RSI");
    expect(pickOscillator(["Stoch RSI 14 14 3 3|%K"], "RSI")).toEqual({ key: null, label: "RSI 14 (dihitung radar)" });
    expect(DEFAULT_DIV.oscillator).toBe("RSI");
  });
  it("MEDC tanpa kolom RSI -> RSI 14 dihitung dari close", () => {
    document.body.innerHTML = readFileSync(resolve(import.meta.dirname, "../../fixtures/chartbit-table-medc.html"), "utf8");
    const a = analyzeSymbol("MEDC", "1D", parseChartTable(document).bars, DEFAULT_DIV);
    expect(a.oscLabel).toBe("RSI 14 (dihitung radar)");
  });
  it("progres pindai per hari bursa", () => {
    const st = (symbol: string, t: string) => ({ symbol, tf: "1D", updatedAt: 1, bars: [{ t, o: 1, h: 1, l: 1, c: 1, ind: {} }] });
    const p = scanProgress(["BBCA", "MEDC", "PGAS", "TLKM"], [st("MEDC", "2026-11-13"), st("BBCA", "2026-11-12"), st("TLKM", "2026-11-13 15:00")], "2026-11-13");
    expect(p.done).toEqual(["MEDC", "TLKM"]);
    expect(p.todo).toEqual([{ code: "BBCA", lastT: "2026-11-12" }, { code: "PGAS", lastT: null }]);
    expect(p.next).toBe("BBCA");
    expect(normalizeScanList("bbca, medc\npgas pgas")).toEqual(["BBCA", "MEDC", "PGAS"]);
    expect(chartbitUrl("MEDC")).toBe("https://stockbit.com/symbol/MEDC/chartbit");
  });
});

describe("kolom RSI asli Chartbit (dicek live 2026-11-14)", () => {
  it("grup 'RSI 14' dengan kolom 'Plot' dipilih; label = nama indikator", () => {
    const keys = ["Stoch RSI 14 14 3 3|%K", "Stoch RSI 14 14 3 3|%D", "RSI 14|Plot"];
    expect(pickOscillator(keys, "RSI")).toEqual({ key: "RSI 14|Plot", label: "RSI 14" });
  });
});
