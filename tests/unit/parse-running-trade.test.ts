// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import selectors from "../../src/config/selectors.json";
import { parseRunningTrade, type RunningTradeSelectors } from "../../src/content/parse-running-trade";
import { tradeValue } from "../../src/core/normalize";

const sel = selectors.runningTrade as RunningTradeSelectors;
const html = readFileSync(resolve(import.meta.dirname, "../../fixtures/running-trade.html"), "utf8");
const load = (src = html) => { document.documentElement.innerHTML = src.replace(/^<!doctype html>/i, ""); };

describe("parser running trade (fixture DOM asli Stockbit 2026-11-13)", () => {
  beforeEach(() => load());

  it("34 baris, semua terbaca, urut terbaru di atas, broker tampil", () => {
    const r = parseRunningTrade(document, sel);
    expect(r.found).toBe(true);
    expect(r.rowsTotal).toBe(34);
    expect(r.rowsOk).toBe(34);
    expect(r.errors).toEqual([]);
    expect(r.newestFirst).toBe(true);
    expect(r.brokerVisible).toBe(true);
  });

  it("baris pertama BBRI", () => {
    const t = parseRunningTrade(document, sel).rows[0]!;
    expect(t).toMatchObject({
      time: "16:27:10", code: "BBRI", price: 3042, chgPct: 2.81, action: "B", lot: 11404,
      buyer: "AK", buyerType: "F", seller: "AK", sellerType: "F", board: "NG",
    });
    expect(t.displayValue).toBeCloseTo(3.5e9);
  });

  it("baris Sell, lot pecahan NG, perubahan 0.00%", () => {
    const rows = parseRunningTrade(document, sel).rows;
    const mbma = rows.find((r) => r.code === "MBMA")!;
    expect(mbma).toMatchObject({ action: "S", lot: 5, buyer: "XL", buyerType: "D", seller: "YP", sellerType: "D", board: "RG" });
    const vktr = rows.find((r) => r.code === "VKTR")!;
    expect(vktr.lot).toBe(0.35);
    expect(rows.find((r) => r.code === "ATLA")!.chgPct).toBe(0);
  });

  it("Val di layar = harga × lot × 100 (selisih hanya pembulatan tampilan)", () => {
    for (const r of parseRunningTrade(document, sel).rows) {
      const v = tradeValue(r.price, r.lot);
      expect(Math.abs(v - r.displayValue!) / v).toBeLessThan(0.06);
    }
  });

  it("baris identik berulang punya key sama (dibedakan oleh pelacak, bukan parser)", () => {
    const keys = parseRunningTrade(document, sel).rows.map((r) => r.key);
    const goto = keys.filter((k) => k === "16:14:59|GOTO|26|33690|B|PP|D|XL|D|RG");
    expect(goto.length).toBe(6);
  });
});

describe("ketahanan parser running trade", () => {
  it("panel tertutup -> found=false, tidak crash", () => {
    load("<html><body><p>tanpa panel</p></body></html>");
    expect(parseRunningTrade(document, sel)).toMatchObject({ found: false, rowsTotal: 0 });
  });

  it("judul kolom berubah -> error jelas, 0 baris ok", () => {
    load(html.replace("<th>Lot</th>", "<th>Volume</th>"));
    const r = parseRunningTrade(document, sel);
    expect(r.rowsOk).toBe(0);
    expect(r.errors[0]).toMatch(/lot/);
  });

  it("urutan kolom berubah tetap terbaca lewat judul", () => {
    load(html.replace("<th>Buyer</th><th>Seller</th>", "<th>Seller</th><th>Buyer</th>"));
    const t = parseRunningTrade(document, sel).rows.find((r) => r.code === "MBMA")!;
    expect(t.buyer).toBe("YP");
    expect(t.seller).toBe("XL");
  });

  it("sel rusak -> baris itu gagal saja", () => {
    load(html.replace("<td>11,404</td>", "<td>abc</td>"));
    const r = parseRunningTrade(document, sel);
    expect(r.rowsOk).toBe(33);
    expect(r.errors).toHaveLength(1);
  });

  it("diurutkan Time naik -> newestFirst=false", () => {
    load(html.replace("<td>16:27:10</td>", "<td>09:00:00</td>"));
    expect(parseRunningTrade(document, sel).newestFirst).toBe(false);
  });

  it("broker tidak tampil (disembunyikan BEI) -> brokerVisible=false", () => {
    load(html.replace(/<div>[A-Z]{2} <span>\[[DF]\]<\/span><\/div>/g, "<div>-</div>"));
    const r = parseRunningTrade(document, sel);
    expect(r.brokerVisible).toBe(false);
    expect(r.rowsOk).toBe(34);
    expect(r.rows[0]!.buyer).toBeUndefined();
  });
});

describe("running trade saat SESI LIVE (judul & isi di dua tabel, data-row-key)", () => {
  it("membaca 5 baris, lewati baris pengukur, kunci unik & waktu epoch", () => {
    document.body.innerHTML = readFileSync(resolve(import.meta.dirname, "../../fixtures/running-trade-live.html"), "utf8");
    const r = parseRunningTrade(document, sel);
    expect(r).toMatchObject({ found: true, rowsTotal: 5, rowsOk: 5, newestFirst: true, brokerVisible: false, errors: [] });
    expect(r.rows[0]).toMatchObject({ time: "09:37:50", code: "MSIN", price: 114, chgPct: 26.67, action: "B", lot: 102, board: "RG", key: "MSIN|413292", tradeNo: 413292, epochMs: 1794796670000, displayValue: 1.2e6 });
    // dua baris MORA identik isinya tetap berbeda kunci (nomor trade)
    expect(r.rows.filter((x) => x.code === "MORA").map((x) => x.key)).toEqual(["MORA|413289", "MORA|413288"]);
  });
});
