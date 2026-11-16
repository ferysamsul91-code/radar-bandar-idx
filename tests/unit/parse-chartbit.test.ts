// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseChartTable, parseTvDate } from "../../src/content/parse-chartbit";

const FIX = readFileSync(resolve(import.meta.dirname, "../../fixtures/chartbit-table-medc.html"), "utf8");

describe("parser Chartbit Table view (MEDC 1D, fixture asli)", () => {
  it("simbol, timeframe, indikator, 39 candle", () => {
    document.body.innerHTML = FIX;
    const r = parseChartTable(document);
    expect(r).toMatchObject({ found: true, symbol: "MEDC", timeframe: "1D", rowsTotal: 39, rowsOk: 39 });
    expect(r.indicators).toEqual(["Stoch RSI 14 14 3 3|%K", "Stoch RSI 14 14 3 3|%D"]);
    expect(r.bars[0]).toEqual({ t: "2026-11-13", o: 1230, h: 1235, l: 1200, c: 1230, ind: { "Stoch RSI 14 14 3 3|%K": 39.3, "Stoch RSI 14 14 3 3|%D": 20.8 } });
    expect(r.bars[3]!.ind["Stoch RSI 14 14 3 3|%K"]).toBeCloseTo(0, 5); // "−0.0" di layar
    expect(r.bars[38]).toMatchObject({ t: "2026-09-22", h: 1580, c: 1465 });
  });
  it("tanggal TradingView", () => {
    expect(parseTvDate("Fri 13 Nov '26")).toBe("2026-11-13");
    expect(parseTvDate("Mon 02 Nov '26 09:30")).toBe("2026-11-02 09:30");
    expect(parseTvDate("x")).toBeNull();
  });
  it("tabel di dalam iframe TradingView (origin sama) & tanpa tabel", () => {
    // happy-dom tidak memuat iframe: dokumen tiruan dengan satu iframe TradingView (di Chrome: blob: origin sama).
    const inner = document.implementation.createHTMLDocument("tv");
    inner.body.innerHTML = FIX;
    const outer = { querySelector: () => null, querySelectorAll: () => [{ contentDocument: inner }] } as unknown as Document;
    expect(parseChartTable(outer)).toMatchObject({ found: true, symbol: "MEDC", rowsOk: 39 });
    document.body.innerHTML = "<div></div>";
    expect(parseChartTable(document).found).toBe(false);
  });
});
