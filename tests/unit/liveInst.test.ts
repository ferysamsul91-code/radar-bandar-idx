// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeLive, summarize, type LiveEvent, type LiveRec } from "../../src/core/liveTrace";
import { histKey, LIVE_PREFIX, liveInstCSV, makeReport, putHistory, type LiveDay, type RekapHistory } from "../../src/core/rekapRange";
import { historyDays, isBackupKey } from "../../src/core/backup";
import { parseBrokerAnalysis } from "../../src/content/parse-rekap";
import type { InstSnap } from "../../src/core/rekap";
import { rekapView } from "../../src/ui/rekapView";
import { rekapPdf } from "../../src/ui/rekapPdf";

const T = Date.UTC(2026, 10, 13, 2, 0); // 09:00 WIB
const ev = (code: string, side: "BELI" | "JUAL", startMin: number, lenMin: number, value: number, category: LiveEvent["category"], id = 1): LiveEvent => ({
  id, code, side, startTs: T + startMin * 60e3, lastTs: T + (startMin + lenMin) * 60e3, trades: 3, lot: 0, value, avg: 0,
  foreignDelta: null, foreignShare: null, category,
});
const rec = (e: LiveEvent): LiveRec => ({ code: e.code, side: e.side, startTs: e.startTs, lastTs: e.lastTs, trades: e.trades, value: e.value, category: e.category });
const day = (d: string, recs: LiveRec[]): LiveDay => ({ day: d, savedAt: 0, rows: summarize(recs), recs });

describe("rekaman pola live harian", () => {
  it("rangkaian yang tumpang (deteksi ulang setelah muat ulang) tidak dihitung dua kali", () => {
    const stored = [rec(ev("ASII", "BELI", 0, 4, 2e9, "INSTITUSI/LOKAL"))];
    const m = mergeLive(stored, [ev("ASII", "BELI", 2, 5, 3e9, "INSTITUSI/LOKAL"), ev("ASII", "JUAL", 2, 5, 1e9, "ASING"), ev("ASII", "BELI", 30, 2, 1e9, "?")]);
    expect(m).toHaveLength(3);
    expect(m[0]).toMatchObject({ side: "BELI", startTs: T, lastTs: T + 7 * 60e3, value: 3e9, category: "INSTITUSI/LOKAL" });
    expect(summarize(m)[0]).toMatchObject({ code: "ASII", instBuy: 3e9, asingSell: 1e9, buy: 4e9, runs: 3, instRuns: 1 });
  });
  it("kategori '?' tidak menimpa kategori yang sudah terukur", () => {
    const m = mergeLive([rec(ev("BBRI", "BELI", 0, 3, 2e9, "ASING"))], [ev("BBRI", "BELI", 1, 3, 2.5e9, "?")]);
    expect(m[0]).toMatchObject({ value: 2.5e9, category: "ASING" });
  });
});

describe("REKAP: DETEKSI INSTITUSI BELI", () => {
  document.body.innerHTML = readFileSync(resolve(import.meta.dirname, "../../fixtures/broker-analysis.html"), "utf8");
  const BA = parseBrokerAnalysis(document);
  const h: RekapHistory = { fbuy: {}, fsell: {}, inst: {} };
  const snapI = (d: string): InstSnap => ({ capturedAt: Date.parse(`${d}T10:00:00Z`), day: d, ...BA, dateText: "x" });
  putHistory(h, histKey("inst", "2026-11-13", "2026-11-13"), snapI("2026-11-13"));
  putHistory(h, LIVE_PREFIX + "2026-11-12", day("2026-11-12", [
    rec(ev("ASII", "BELI", 0, 3, 3e9, "INSTITUSI/LOKAL")),
    rec(ev("ASII", "JUAL", 10, 3, 1e9, "INSTITUSI/LOKAL")),
    rec(ev("BBRI", "JUAL", 0, 3, 5e9, "INSTITUSI/LOKAL")),
  ]));
  putHistory(h, LIVE_PREFIX + "2026-11-13", day("2026-11-13", [
    rec(ev("ASII", "BELI", 0, 3, 2e9, "INSTITUSI/LOKAL")),
    rec(ev("ZZZZ", "BELI", 0, 3, 1.5e9, "INSTITUSI/LOKAL")),
    rec(ev("ZZZZ", "BELI", 20, 3, 9e9, "ASING")),
    rec(ev("GOTO", "BELI", 0, 3, 4e9, "?")),
    rec(ev("GOTO", "JUAL", 9, 3, 1e9, "?")),
  ]));
  const latest = { fb: null, fs: null, inst: null };

  it("rentang: dijumlah per emiten, hanya net beli institusi, urut net terbesar, pembanding Broker Analysis", () => {
    const r = makeReport(latest, h, { mode: "custom", from: "2026-11-12", to: "2026-11-13" }, "2026-11-13");
    expect(r.liveDays).toBe(2);
    expect(r.liveDayCount).toBe(2);
    expect(r.liveInst.map((x) => x.code)).toEqual(["ASII", "ZZZZ"]); // BBRI net jual -> tidak masuk
    expect(r.liveInst[0]).toMatchObject({ instBuy: 5e9, instSell: 1e9, net: 4e9, instRuns: 3, days: 2 });
    expect(r.liveInst[0]!.ba).toBeGreaterThan(0); // ASII net beli institusi di Broker Analysis 13 Nov
    expect(r.liveInst[1]).toMatchObject({ code: "ZZZZ", net: 1.5e9, asingBuy: 9e9, days: 1, ba: null });
  });
  it("pola tanpa kategori (?) dipisah; CSV", () => {
    const r = makeReport(latest, h, { mode: "today" }, "2026-11-13");
    expect(r.liveInst.map((x) => x.code)).not.toContain("GOTO");
    expect(r.liveUnknown[0]).toMatchObject({ code: "GOTO", unkBuy: 4e9, unkSell: 1e9 });
    const csv = liveInstCSV(r).trim().split("\n");
    expect(csv[0]).toContain("data pola 1/1 hari bursa");
    expect(csv[2]).toMatch(/^inst beli pola,ASII,2000000000,0,2000000000,1,1,0,0,0,0,\d+$/);
    expect(csv.at(-1)).toMatch(/^beli lot besar \? \(tanpa widget\),GOTO,/);
  });
  it("hari ini saja", () => {
    const r = makeReport(latest, h, { mode: "today" }, "2026-11-13");
    expect(r.liveDays).toBe(1);
    expect(r.liveInst[0]).toMatchObject({ code: "ASII", instBuy: 2e9, net: 2e9, days: 1 });
  });
  it("tampil di tab REKAP & PDF (juga saat Movers/Broker Analysis belum diambil)", () => {
    const html = rekapView(latest, { ...h, inst: {} }, { mode: "today" }, "2026-11-13", 0);
    expect(html).toContain("DETEKSI INSTITUSI BELI");
    expect(html).toContain('data-code="ASII"');
    expect(html).toContain("data pola 1/1 hari bursa");
    expect(html).toContain("tidak di daftar");
    expect(html).toContain("TANPA widget orderbook (1)");
    const html2 = rekapView(latest, h, { mode: "custom", from: "2026-11-12", to: "2026-11-13" }, "2026-11-13", 0);
    expect(html2).toContain("✓ searah");
    expect(html2).toContain("<th>HARI</th>");
    const pdf = rekapPdf(makeReport(latest, h, { mode: "today" }, "2026-11-13"), 0);
    expect(pdf).toContain("DETEKSI INSTITUSI BELI - pola lot besar live \\(2\\)"); // ASII + ZZZZ
    expect(pdf).toContain("(ASII)");
  });
  it("hapus & cadangan", () => {
    const h2: RekapHistory = { fbuy: {}, fsell: {}, inst: {}, live: { ...h.live } };
    expect(putHistory(h2, LIVE_PREFIX + "2026-11-12", undefined)).toBe(true);
    expect(Object.keys(h2.live!)).toEqual(["2026-11-13"]);
    expect(isBackupKey("rbLiveH:2026-11-13")).toBe(true);
    expect(historyDays(["rbLiveH:2026-11-13"])).toEqual(["2026-11-13"]);
  });
});
