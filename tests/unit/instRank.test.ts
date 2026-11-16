// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ForeignSnap, InstSnap } from "../../src/core/rekap";
import { histKey, instRankCSV, makeReport, putHistory, TRACE_PREFIX, type RekapHistory } from "../../src/core/rekapRange";
import { parseBrokerAnalysis, parseMoversForeign } from "../../src/content/parse-rekap";
import { rekapView } from "../../src/ui/rekapView";
import { rekapPdf } from "../../src/ui/rekapPdf";

const fx = (f: string) => readFileSync(resolve(import.meta.dirname, "../../fixtures", f), "utf8");
document.body.innerHTML = fx("movers-net-foreign-buy.html");
const BUY = parseMoversForeign(document).rows;
document.body.innerHTML = fx("movers-net-foreign-sell.html");
const SELL = parseMoversForeign(document).rows;
document.body.innerHTML = fx("broker-analysis.html");
const BA = parseBrokerAnalysis(document);
const snapF = (kind: "buy" | "sell", day: string, rows = kind === "buy" ? BUY : SELL): ForeignSnap => ({ kind, day, capturedAt: Date.parse(`${day}T10:00:00Z`), rows });
const snapI = (day: string, over: Partial<InstSnap> = {}): InstSnap => ({ capturedAt: Date.parse(`${day}T10:00:00Z`), day, ...BA, dateText: "x", ...over });

describe("DAFTAR TOTAL INSTITUSI", () => {
  const h: RekapHistory = { fbuy: {}, fsell: {}, inst: {} };
  putHistory(h, histKey("fbuy", "2026-11-13"), snapF("buy", "2026-11-13"));
  putHistory(h, histKey("fsell", "2026-11-13"), snapF("sell", "2026-11-13"));
  // 12 Nov: ASII net beli 20 M, ZZZZ net beli 5 M (ZZZZ tidak ada di Movers -> institusi saja); BBRI net jual 3 M.
  putHistory(h, histKey("inst", "2026-11-12", "2026-11-12"), snapI("2026-11-12", {
    buys: [{ code: "ASII", value: 20e9, lot: null, freq: null, avg: 5400 }, { code: "ZZZZ", value: 5e9, lot: null, freq: null, avg: 100 }],
    sells: [{ code: "BBRI", value: 3e9, lot: null, freq: null, avg: 3000 }],
  }));
  putHistory(h, histKey("inst", "2026-11-13", "2026-11-13"), snapI("2026-11-13"));
  const latest = { fb: null, fs: null, inst: null };
  const r = makeReport(latest, h, { mode: "custom", from: "2026-11-12", to: "2026-11-13" }, "2026-11-13");

  it("semua emiten net beli institusi dari semua kelompok, urut nilai, porsi & hari beli", () => {
    const k = r.instRank;
    expect(k.dataDays).toBe(2);
    expect(k.buy.length).toBe(r.rekap.bothBuy.length + r.rekap.instOnlyBuy.length + r.rekap.divergent.filter((x) => (x.inst ?? 0) > 0).length);
    expect(k.buy.map((x) => x.rank)).toEqual(k.buy.map((_, i) => i + 1));
    for (let i = 1; i < k.buy.length; i++) expect(k.buy[i - 1]!.inst).toBeGreaterThanOrEqual(k.buy[i]!.inst);
    expect(k.buy.reduce((s, x) => s + x.inst, 0)).toBeCloseTo(r.totals.instBuy, -3);
    expect(k.buy.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 6);
    expect(k.buy.find((x) => x.code === "ASII")).toMatchObject({ days: 2 });
    expect(k.buy.find((x) => x.code === "ZZZZ")).toMatchObject({ inst: 5e9, days: 1, foreign: null });
    expect(k.sell.every((x) => x.inst < 0)).toBe(true);
    expect(k.sell.reduce((s, x) => s - x.inst, 0)).toBeCloseTo(r.totals.instSell, -3);
  });
  it("rentang langsung dari Broker Analysis: tanpa hitungan hari; pengambilan terakhir juga", () => {
    const h2: RekapHistory = { ...h, inst: { ...h.inst } };
    putHistory(h2, histKey("inst", "2026-11-12", "2026-11-13"), snapI("2026-11-13", { dateText: "12 Nov 26–13 Nov 26" }));
    const r2 = makeReport(latest, h2, { mode: "custom", from: "2026-11-12", to: "2026-11-13" }, "2026-11-13");
    expect(r2.instRank.dataDays).toBeNull();
    expect(r2.instRank.buy[0]!.days).toBeNull();
    const r3 = makeReport({ fb: snapF("buy", "2026-11-13"), fs: snapF("sell", "2026-11-13"), inst: snapI("2026-11-13") }, h, { mode: "latest" }, "2026-11-13");
    expect(r3.instRank.dataDays).toBeNull();
    expect(r3.instRank.buy.length).toBeGreaterThan(5);
  });
  it("sumber jejak running trade: hari dihitung dari net harian", () => {
    const h4: RekapHistory = { fbuy: {}, fsell: {}, inst: {}, trace: {} };
    const net = (code: string, broker: string, buy: number, sell: number) => ({ code, broker, buy, sell, buyLot: 1, sellLot: 1, buyAvg: 100, sellAvg: 100, runs: 1 });
    putHistory(h4, TRACE_PREFIX + "2026-11-12", { day: "2026-11-12", savedAt: 0, nets: [net("ASII", "AK", 5e9, 0), net("ASII", "BK", 0, 1e9)] });
    putHistory(h4, TRACE_PREFIX + "2026-11-13", { day: "2026-11-13", savedAt: 0, nets: [net("ASII", "AK", 0, 2e9)] });
    const r4 = makeReport(latest, h4, { mode: "custom", from: "2026-11-12", to: "2026-11-13", instSrc: "trace" }, "2026-11-13");
    expect(r4.instRank.dataDays).toBe(2);
    expect(r4.instRank.buy[0]).toMatchObject({ code: "ASII", inst: 2e9, days: 1, share: 1 });
  });
  it("tampil di REKAP, PDF, CSV", () => {
    const html = rekapView(latest, h, { mode: "custom", from: "2026-11-12", to: "2026-11-13" }, "2026-11-13", 0);
    expect(html).toContain("DAFTAR TOTAL INSTITUSI NET BELI");
    expect(html).toContain("DAFTAR TOTAL INSTITUSI NET JUAL");
    expect(html).toContain("<th>HARI BELI</th>");
    expect(html).toMatch(/data-code="ZZZZ"/);
    const pdf = rekapPdf(r, 0);
    expect(pdf).toContain(`DAFTAR TOTAL INSTITUSI NET BELI \\(${r.instRank.buy.length} emiten`);
    expect(pdf).toContain("DAFTAR TOTAL INSTITUSI NET JUAL");
    const csv = instRankCSV(r).trim().split("\n");
    expect(csv[0]).toContain("data harian 2 hari");
    expect(csv[1]).toBe("sisi,peringkat,kode,inst_net,porsi_pct,avg_inst,hari_searah,asing_net,harga,chg_pct");
    expect(csv[2]).toMatch(/^net beli,1,[A-Z]{4},\d+,/);
    expect(csv.at(-1)).toMatch(/^net jual,\d+,[A-Z]{4},-\d+,/);
  });
});
