// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import thresholds from "../../src/config/thresholds.json";
import { buildRekap, parseShortDate, rekapToCSV, type ForeignSnap, type InstSnap } from "../../src/core/rekap";
import { lastTradingDate, type SessionCfg } from "../../src/core/session";
import { parseBrokerAnalysis, parseMoversForeign } from "../../src/content/parse-rekap";

const fx = (f: string) => readFileSync(resolve(import.meta.dirname, "../../fixtures", f), "utf8");
const load = (f: string) => {
  document.body.innerHTML = fx(f);
  return document;
};

describe("parser Movers Net Foreign (fixture asli 13 Nov 26)", () => {
  it("tab Net Foreign Buy", () => {
    const r = parseMoversForeign(load("movers-net-foreign-buy.html"));
    expect(r).toMatchObject({ found: true, kind: "buy", rowsTotal: 18, rowsOk: 18 });
    expect(r.rows[0]).toEqual({ code: "ASII", amount: 78.63e9, value: 277.88e9, price: 5500, chgPct: 0.92 });
    expect(r.rows.find((x) => x.code === "KLBF")).toMatchObject({ amount: 10.95e9, chgPct: -0.65 });
  });
  it("tab Net Foreign Sell: nilai positif = besar net jual", () => {
    const r = parseMoversForeign(load("movers-net-foreign-sell.html"));
    expect(r).toMatchObject({ found: true, kind: "sell", rowsOk: 8 });
    expect(r.rows[0]).toEqual({ code: "BBRI", amount: 140.89e9, value: 1.13e12, price: 3060, chgPct: 0.99 });
    expect(r.rows.find((x) => x.code === "BMRI")!.chgPct).toBe(0);
  });
  it("tab lain (mis. Top Gainer) -> found tanpa kind; tanpa panel -> not found", () => {
    document.body.innerHTML = fx("movers-net-foreign-buy.html").replace(/id="netForeignBuy"/, 'id="change"');
    expect(parseMoversForeign(document)).toMatchObject({ found: true, kind: null, rows: [] });
    document.body.innerHTML = "<div></div>";
    expect(parseMoversForeign(document).found).toBe(false);
  });
});

describe("parser Broker Analysis (AK ZP BK KZ RX, 13 Nov 26)", () => {
  it("broker terpilih, tanggal, filter, top buy/sell", () => {
    const r = parseBrokerAnalysis(load("broker-analysis.html"));
    expect(r.found).toBe(true);
    expect(r.brokers.map((b) => b.code)).toEqual(["AK", "ZP", "BK", "KZ", "RX"]);
    expect(r.brokers[0]!.type).toBe("foreign");
    expect(r).toMatchObject({ dateText: "13 Nov 26", metric: "Value", investor: "All Investor", board: "Regular", rowsTotal: 40, rowsOk: 40, bothSides: [] });
    expect(r.buys[0]).toEqual({ code: "BBCA", value: 70.9e9, lot: 129_200, freq: 18_446, avg: 5522 });
    expect(r.sells[0]).toEqual({ code: "BBRI", value: 100.3e9, lot: 326_600, freq: 15_542, avg: 3050 });
    expect(r.sells.find((x) => x.code === "ITMG")!.avg).toBe(24_458);
  });
  it("emiten di dua sisi -> tanda mode Gross", () => {
    document.body.innerHTML = fx("broker-analysis.html").replace('alt="BBRI">BBRI', 'alt="BBCA">BBCA');
    expect(parseBrokerAnalysis(document).bothSides).toEqual(["BBCA"]);
  });
  it("halaman tanpa tabel -> not found", () => {
    document.body.innerHTML = "<table><thead><tr><th>Symbol</th></tr></thead></table>";
    expect(parseBrokerAnalysis(document).found).toBe(false);
  });
});

describe("rekap 4 kelompok", () => {
  const snapF = (f: string, kind: "buy" | "sell"): ForeignSnap => ({ kind, capturedAt: 1, day: "2026-11-13", rows: parseMoversForeign(load(f)).rows });
  const fb = snapF("movers-net-foreign-buy.html", "buy");
  const fs = snapF("movers-net-foreign-sell.html", "sell");
  const ba = parseBrokerAnalysis(load("broker-analysis.html"));
  const inst: InstSnap = { capturedAt: 2, day: parseShortDate(ba.dateText), ...ba };
  const r = buildRekap(fb, fs, inst);

  it("asing & institusi searah", () => {
    expect(r.bothBuy[0]).toMatchObject({ code: "ASII", foreign: 78.63e9, inst: 56.8e9, instAvg: 5462, price: 5500 });
    expect(r.bothBuy.map((x) => x.code)).toEqual(expect.arrayContaining(["MDKA", "ESSA", "TINS", "BUMI", "ICBP", "ENRG"]));
    expect(r.bothSell[0]).toMatchObject({ code: "BBRI", foreign: -140.89e9, inst: -100.3e9 });
    expect(r.bothSell.map((x) => x.code)).toEqual(["BBRI", "TLKM", "BMRI", "BREN", "DEWA", "CPIN"]);
  });
  it("berlawanan & satu pihak", () => {
    expect(r.divergent.map((x) => x.code)).toEqual(["BBCA", "SINI"]);
    expect(r.foreignOnlyBuy.map((x) => x.code)).toEqual(["PGAS"]);
    expect(r.foreignOnlySell.map((x) => x.code)).toEqual(["BRPT"]);
    expect(r.instOnlySell.map((x) => x.code)).toContain("UNVR");
    // fixture asing beli hanya 18 baris, jadi MEDC/DKFT/CTRA tidak punya data asing
    expect(r.instOnlyBuy.map((x) => x.code)).toEqual(["MEDC", "DKFT", "CTRA"]);
    expect(r.warnings).toEqual([]);
  });
  it("peringatan data belum lengkap / tanggal beda", () => {
    expect(buildRekap(null, fs, null).warnings).toHaveLength(2);
    const w = buildRekap(fb, fs, { ...inst, day: "2026-11-12", dateText: "12 Nov 26" }).warnings;
    expect(w[0]).toContain("12 Nov 26");
  });
  it("CSV", () => {
    const lines = rekapToCSV(r).trim().split("\n");
    expect(lines[0]).toBe("kelompok,kode,asing_net,inst_net,avg_inst,harga,chg_pct");
    expect(lines[1]).toBe("asing+inst beli,ASII,78630000000,56800000000,5462,5500,0.92");
  });
});

describe("tanggal", () => {
  it("parseShortDate", () => {
    expect(parseShortDate("13 Nov 26")).toBe("2026-11-13");
    expect(parseShortDate("5 Agu 2026")).toBe("2026-08-05");
    expect(parseShortDate("x")).toBeNull();
  });
  it("lastTradingDate: Sabtu -> Jumat, Senin pagi -> Jumat, Senin siang -> Senin", () => {
    const s = thresholds.sessions as unknown as SessionCfg;
    const wib = (d: number, h: number) => Date.UTC(2026, 10, d, h - 7, 0);
    expect(lastTradingDate(wib(14, 2), s)).toBe("2026-11-13");
    expect(lastTradingDate(wib(16, 8), s)).toBe("2026-11-13");
    expect(lastTradingDate(wib(16, 10), s)).toBe("2026-11-16");
    expect(lastTradingDate(wib(13, 16), s)).toBe("2026-11-13");
  });
});

describe("filter Broker Analysis dibaca dari combobox (bukan tab di pemilih broker)", () => {
  it("tab 'Foreign' di dropdown pemilih broker tidak terbaca sebagai filter investor", () => {
    const decoy = `<div class="dropdown"><button type="button">All</button><button type="button">Local</button><button type="button">BUMN</button><button type="button">Foreign</button></div>`;
    document.body.innerHTML = decoy + fx("broker-analysis.html");
    expect(parseBrokerAnalysis(document)).toMatchObject({ investor: "All Investor", metric: "Value", board: "Regular", dateText: "13 Nov 26" });
  });
});

describe("peringatan broker ritel di REKAP", () => {
  it("XL/XC terpilih sebagai institusi -> peringatan", () => {
    document.body.innerHTML = fx("broker-analysis.html");
    const ba = parseBrokerAnalysis(document);
    const inst: InstSnap = { capturedAt: 1, day: "2026-11-13", ...ba, brokers: [{ code: "XL", type: "local" }, { code: "AK", type: "foreign" }] };
    expect(buildRekap(null, null, inst).warnings.some((w) => w.includes("Broker ritel XL"))).toBe(true);
    expect(buildRekap(null, null, { ...inst, brokers: [{ code: "AK", type: "foreign" }] }).warnings.some((w) => w.includes("ritel"))).toBe(false);
  });
});
