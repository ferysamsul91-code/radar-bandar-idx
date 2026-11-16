// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import selectors from "../../src/config/selectors.json";
import { sameSummary, summarizeBrokerSummary } from "../../src/core/brokerSummary";
import { parseBrokerSummary, symbolFromPath, type BrokerSummarySelectors } from "../../src/content/parse-broker-summary";

const sel = selectors.brokerSummary as unknown as BrokerSummarySelectors;
const FIX = readFileSync(resolve(import.meta.dirname, "../../fixtures/broker-summary.html"), "utf8");
const cfg = { topN: 3, accDistThreshold: 0.3 };

describe("parser Broker Summary (fixture asli BBCA 13 Nov 26)", () => {
  beforeEach(() => {
    document.body.innerHTML = FIX;
  });

  it("membaca tanggal, filter, dan 25 baris tanpa error", () => {
    const r = parseBrokerSummary(document, sel);
    expect(r).toMatchObject({ found: true, dateText: "13 Nov 26", investor: "All Investor", board: "Regular", mode: "Net", rowsTotal: 25, rowsOk: 25, errors: [] });
    expect(r.buyers).toHaveLength(25);
    expect(r.sellers).toHaveLength(25);
  });

  it("angka & kategori broker dari atribut type Stockbit", () => {
    const r = parseBrokerSummary(document, sel);
    expect(r.buyers[0]).toEqual({ broker: "KZ", owner: "foreign", value: 185.2e9, lot: 334_900, avg: 5522 });
    expect(r.sellers[1]).toEqual({ broker: "CC", owner: "bumn", value: 27.2e9, lot: 47_700, avg: 5558 });
    expect(r.buyers[2]).toMatchObject({ broker: "PD", owner: "local", value: 17.5e9, lot: 32_000 });
    expect(r.buyers[16]).toMatchObject({ broker: "AK", value: 718.1e6, lot: 814 });
    expect(r.buyers[24]).toMatchObject({ broker: "EL", value: 2.8e6, lot: 5, avg: 5575 });
  });

  it("mode Net: total beli ≈ total jual (cek kewajaran data)", () => {
    const r = parseBrokerSummary(document, sel);
    const s = summarizeBrokerSummary("BBCA", r, 0, cfg);
    expect(Math.abs(s.totalBuy - s.totalSell) / s.totalBuy).toBeLessThan(0.02);
  });

  it("ringkasan: net per kategori, top buyer/seller, akumulasi", () => {
    const s = summarizeBrokerSummary("BBCA", parseBrokerSummary(document, sel), 1, cfg);
    expect(s.topBuyers.map((x) => x.broker)).toEqual(["KZ", "BK", "PD"]);
    expect(s.topSellers.map((x) => x.broker)).toEqual(["ZP", "CC", "BB"]);
    // asing beli: KZ BK AI DP CP AG AK LS = 185.2+55.9+13.2+7.4+3.3+1.3+0.7181+0.5098 B
    // asing jual: ZP YP RX TP KK YU BQ HD FS = 158.3+21.2+12.7+7.2+2.9+2.8+1.5+0.703+0.3994 B
    expect(s.net.foreign / 1e9).toBeCloseTo(267.5279 - 207.7024, 3);
    expect(s.net.bumn / 1e9).toBeCloseTo(-(27.2 + 12.8 + 2), 3);
    expect(s.net.unknown).toBe(0);
    expect(s.accDist!).toBeCloseTo((258.6 - 208.3) / (258.6 + 208.3), 6);
    expect(s.accDistLabel).toBe("NETRAL");
    expect(s.owners).toMatchObject({ KZ: "foreign", CC: "bumn", XL: "local", YP: "foreign" });
    expect(sameSummary(s, { ...s, capturedAt: 99 })).toBe(true);
  });

  it("tanpa widget -> found false; kolom hilang -> error", () => {
    document.body.innerHTML = "<p>Broker Summary</p>";
    expect(parseBrokerSummary(document, sel).found).toBe(false);
    document.body.innerHTML = FIX.replace(">B.val<", ">X.val<");
    const r = parseBrokerSummary(document, sel);
    expect(r.found).toBe(true);
    expect(r.errors[0]).toContain("buyVal");
  });

  it("baris dengan sisi kosong tetap terbaca", () => {
    document.body.innerHTML = FIX;
    const last = document.querySelector('tr[data-row-key="24"]')!;
    last.querySelectorAll("td").forEach((td, i) => { if (i < 4) td.innerHTML = ""; });
    const r = parseBrokerSummary(document, sel);
    expect(r.rowsOk).toBe(25);
    expect(r.buyers).toHaveLength(24);
    expect(r.sellers).toHaveLength(25);
  });

  it("kode emiten dari URL", () => {
    expect(symbolFromPath("/symbol/BBCA")).toBe("BBCA");
    expect(symbolFromPath("/symbol/bbri/chartbit")).toBe("BBRI");
    expect(symbolFromPath("/orderbook")).toBeNull();
  });
});
