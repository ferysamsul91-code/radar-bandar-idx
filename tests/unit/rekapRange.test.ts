// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDateRange, parseShortDate, rekapToCSV, type ForeignSnap, type InstSnap } from "../../src/core/rekap";
import { histKey, makeReport, putHistory, resolveRange, shiftTradingDays, tradingDaysBetween, type RekapHistory } from "../../src/core/rekapRange";
import { parseBrokerAnalysis, parseMoversForeign } from "../../src/content/parse-rekap";

const fx = (f: string) => readFileSync(resolve(import.meta.dirname, "../../fixtures", f), "utf8");
const movers = (f: string) => {
  document.body.innerHTML = fx(f);
  return parseMoversForeign(document).rows;
};
const BUY = movers("movers-net-foreign-buy.html");
const SELL = movers("movers-net-foreign-sell.html");
document.body.innerHTML = fx("broker-analysis.html");
const BA = parseBrokerAnalysis(document);
const snapF = (kind: "buy" | "sell", day: string, rows = kind === "buy" ? BUY : SELL): ForeignSnap => ({ kind, day, capturedAt: Date.parse(`${day}T10:00:00Z`), rows });
const snapI = (from: string, to: string, over: Partial<InstSnap> = {}): InstSnap => ({ capturedAt: Date.parse(`${to}T10:00:00Z`), day: to, ...BA, dateText: from === to ? "x" : "range", ...over });

describe("kalender hari bursa", () => {
  it("hari kerja antara dua tanggal (Sabtu/Minggu dilewati)", () => {
    expect(tradingDaysBetween("2026-11-06", "2026-11-13")).toEqual(["2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);
    expect(tradingDaysBetween("2026-11-14", "2026-11-15")).toEqual([]);
  });
  it("geser hari bursa", () => {
    expect(shiftTradingDays("2026-11-13", -5)).toBe("2026-11-06");
    expect(shiftTradingDays("2026-11-16", -1)).toBe("2026-11-13");
  });
  it("pilihan rentang", () => {
    expect(resolveRange({ mode: "latest" }, "2026-11-13")).toBeNull();
    expect(resolveRange({ mode: "today" }, "2026-11-13")).toEqual({ from: "2026-11-13", to: "2026-11-13" });
    expect(resolveRange({ mode: "5d" }, "2026-11-13")).toEqual({ from: "2026-11-06", to: "2026-11-13" });
    expect(resolveRange({ mode: "custom", from: "2026-11-12", to: "2026-11-10" }, "2026-11-13")).toEqual({ from: "2026-11-10", to: "2026-11-12" });
    expect(resolveRange({ mode: "custom" }, "2026-11-13")).toEqual({ from: "2026-11-06", to: "2026-11-13" });
  });
  it("teks tanggal Broker Analysis: satu hari & rentang (format asli)", () => {
    expect(parseDateRange("13 Nov 26")).toEqual({ from: "2026-11-13", to: "2026-11-13" });
    expect(parseDateRange("07 Nov 26–13 Nov 26")).toEqual({ from: "2026-11-07", to: "2026-11-13" });
    expect(parseDateRange("07 Nov 26 – 13 Nov 26")).toEqual({ from: "2026-11-07", to: "2026-11-13" });
    expect(parseDateRange("x")).toBeNull();
    document.body.innerHTML = fx("broker-analysis.html").replace("<span>13 Nov 26</span>", "<span>07 Nov 26–13 Nov 26</span>");
    expect(parseBrokerAnalysis(document).dateText).toBe("07 Nov 26–13 Nov 26");
    expect(parseShortDate("07 Nov 26")).toBe("2026-11-07");
  });
});

describe("riwayat & laporan rentang", () => {
  const h: RekapHistory = { fbuy: {}, fsell: {}, inst: {} };
  // Hari 1 (12 Nov): ASII net beli 10 M, BBRI net jual 40 M. Hari 2 (13 Nov): fixture asli.
  putHistory(h, histKey("fbuy", "2026-11-12"), snapF("buy", "2026-11-12", [{ code: "ASII", amount: 10e9, value: 50e9, price: 5450, chgPct: 0.5 }]));
  putHistory(h, histKey("fsell", "2026-11-12"), snapF("sell", "2026-11-12", [{ code: "BBRI", amount: 40e9, value: 300e9, price: 3030, chgPct: -1 }]));
  putHistory(h, histKey("fbuy", "2026-11-13"), snapF("buy", "2026-11-13"));
  putHistory(h, histKey("fsell", "2026-11-13"), snapF("sell", "2026-11-13"));
  putHistory(h, histKey("inst", "2026-11-12", "2026-11-12"), snapI("2026-11-12", "2026-11-12", { buys: [{ code: "ASII", value: 20e9, lot: null, freq: null, avg: 5400 }], sells: [] }));
  putHistory(h, histKey("inst", "2026-11-13", "2026-11-13"), snapI("2026-11-13", "2026-11-13"));
  const latest = { fb: null, fs: null, inst: null };

  it("asing dijumlah per emiten; harga akhir & perubahan sepanjang rentang", () => {
    const r = makeReport(latest, h, { mode: "custom", from: "2026-11-12", to: "2026-11-13" }, "2026-11-13");
    const asii = r.rekap.bothBuy.find((x) => x.code === "ASII")!;
    expect(asii.foreign).toBeCloseTo(88.63e9, -3);
    // institusi harian dijumlah: 20 M + 56,8 M; avg tertimbang nilai
    expect(asii.inst).toBeCloseTo(76.8e9, -3);
    expect(asii.instAvg).toBe(Math.round((5400 * 20e9 + 5462 * 56.8e9) / 76.8e9));
    expect(asii.price).toBe(5500);
    // prev close sebelum 12 Nov = 5450/1.005; 5500 / (5450/1.005) - 1 = +1,42%
    expect(asii.chgPct).toBeCloseTo(1.42, 2);
    const bbri = r.rekap.bothSell.find((x) => x.code === "BBRI")!;
    expect(bbri.foreign).toBeCloseTo(-180.89e9, -3);
    expect(r.label).toBe("12 Nov 2026 – 13 Nov 2026");
    expect(r.instSource).toContain("jumlah 2/2 hari");
    expect(r.coverage).toEqual([
      { day: "2026-11-12", fb: true, fs: true, inst: true, trace: false },
      { day: "2026-11-13", fb: true, fs: true, inst: true, trace: false },
    ]);
  });
  it("total net beli & jual", () => {
    const r = makeReport(latest, h, { mode: "today" }, "2026-11-13");
    expect(r.totals.foreignBuy / 1e9).toBeCloseTo(78.63 + 34.77 + 34.74 + 32.92 + 30.49 + 28.66 + 20.17 + 19.86 + 17.36 + 16.63 + 16.43 + 14.74 + 12.87 + 11.08 + 10.95 + 3.04 + 2.57 + 8.42, 2);
    expect(r.totals.foreignSell / 1e9).toBeCloseTo(140.89 + 78.48 + 74.33 + 50.42 + 41.67 + 27.04 + 23.59 + 8.17, 2);
    expect(r.totals.instBuy).toBeGreaterThan(0);
    expect(r.totals.instSell).toBeGreaterThan(0);
  });
  it("rentang institusi PERSIS dari Broker Analysis diutamakan", () => {
    const h2: RekapHistory = { ...h, inst: { ...h.inst } };
    putHistory(h2, histKey("inst", "2026-11-12", "2026-11-13"), snapI("2026-11-12", "2026-11-13", {
      dateText: "12 Nov 26–13 Nov 26", buys: [{ code: "ASII", value: 99e9, lot: 1, freq: 1, avg: 5444 }], sells: [],
    }));
    const r = makeReport(latest, h2, { mode: "custom", from: "2026-11-12", to: "2026-11-13" }, "2026-11-13");
    expect(r.instSource).toContain("langsung dari Broker Analysis");
    expect(r.rekap.bothBuy.find((x) => x.code === "ASII")).toMatchObject({ inst: 99e9, instAvg: 5444 });
  });
  it("hari tanpa data tercatat di ketersediaan; peringatan estimasi", () => {
    const r = makeReport(latest, h, { mode: "5d" }, "2026-11-13");
    expect(r.coverage.filter((c) => c.fb).map((c) => c.day)).toEqual(["2026-11-12", "2026-11-13"]);
    expect(r.coverage).toHaveLength(6);
    expect(r.rekap.warnings[0]).toContain("2/6 hari bursa tersimpan");
  });
  it("hapus riwayat & kunci tak dikenal", () => {
    const h3: RekapHistory = { fbuy: { a: snapF("buy", "a") }, fsell: {}, inst: {} };
    expect(putHistory(h3, histKey("fbuy", "a"), undefined)).toBe(true);
    expect(h3.fbuy).toEqual({});
    expect(putHistory(h3, "rbRekap:fbuy", {})).toBe(false);
  });
  it("CSV rentang: label & baris TOTAL", () => {
    const r = makeReport(latest, h, { mode: "today" }, "2026-11-13");
    const lines = rekapToCSV(r.rekap, r.totals, r.label).trim().split("\n");
    expect(lines[0]).toBe("# 13 Nov 2026");
    expect(lines[1]).toBe("kelompok,kode,asing_net,inst_net,avg_inst,harga,chg_pct");
    expect(lines.at(-4)).toMatch(/^TOTAL,asing net beli,\d+/);
    expect(lines.at(-1)).toMatch(/^TOTAL,inst net jual,,-\d+/);
  });
});
