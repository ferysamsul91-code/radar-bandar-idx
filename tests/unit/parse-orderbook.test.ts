// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import selectors from "../../src/config/selectors.json";
import { aqi, depthRatio, foreignNet } from "../../src/core/book";
import { parseOrderbookPage, type OrderbookSelectors } from "../../src/content/parse-orderbook";

const sel = selectors.orderbook as OrderbookSelectors;
const html = readFileSync(resolve(import.meta.dirname, "../../fixtures/orderbook-widgets.html"), "utf8");

function load(src = html): Document {
  document.documentElement.innerHTML = src.replace(/^<!doctype html>/i, "");
  return document;
}

describe("parser orderbook (fixture DOM asli Stockbit 2026-11-13)", () => {
  beforeEach(() => load());

  it("menemukan 2 widget, PARSER 100", () => {
    const r = parseOrderbookPage(document, sel, 1000);
    expect(r.widgets.map((w) => w.code)).toEqual(["BBCA", "TLKM"]);
    expect(r.parserPct).toBe(100);
    expect(r.rowsTotal).toBe(24);
    expect(r.widgets.every((w) => w.ok && w.errors.length === 0)).toBe(true);
  });

  it("BBCA: harga, perubahan, statistik", () => {
    const w = parseOrderbookPage(document, sel, 1000).widgets[0]!;
    const s = w.snapshot!;
    expect(s.ts).toBe(1000);
    expect(s.last).toBe(5500);
    expect(w.change).toEqual({ abs: 25, pct: 0.46 });
    expect(s.open).toBe(5475);
    expect(s.prev).toBe(5475);
    expect(s.high).toBe(5650);
    expect(s.low).toBe(5425);
    expect(s.avg).toBe(5533);
    expect(s.totalLot).toBeCloseTo(2.19e6);
    expect(s.totalValue).toBeCloseTo(1210.57e9);
    expect(s.foreignBuy).toBeCloseTo(667.8e9);
    expect(s.foreignSell).toBeCloseTo(709.5e9);
    expect(s.freq).toBe(44932);
    expect(s.ara).toBeNull(); // isi tombol ARA/ARB dikosongkan di fixture
  });

  it("BBCA: level bid/offer urut & benar", () => {
    const s = parseOrderbookPage(document, sel).widgets[0]!.snapshot!;
    expect(s.bids).toHaveLength(12);
    expect(s.offers).toHaveLength(12);
    expect(s.bids[0]).toEqual({ freq: 234, lot: 17756, price: 5475 });
    expect(s.offers[0]).toEqual({ price: 5500, lot: 58, freq: 4 });
    expect(s.bids[11]).toEqual({ freq: 319, lot: 11081, price: 5200 });
    expect(s.offers[11]).toEqual({ price: 5775, lot: 18582, freq: 223 });
    for (let i = 1; i < 12; i++) {
      expect(s.bids[i]!.price).toBeLessThan(s.bids[i - 1]!.price);
      expect(s.offers[i]!.price).toBeGreaterThan(s.offers[i - 1]!.price);
    }
    expect(s.totals).toEqual({ bidFreq: 5160, bidLot: 349793, offerLot: 729123, offerFreq: 10497 });
  });

  it("baris khusus di atas grid disimpan mentah, tidak masuk level", () => {
    const w = parseOrderbookPage(document, sel).widgets[0]!;
    expect(w.pinnedRowRaw).toEqual(["-", "26,477", "5,475", "5,500", "13,640", "-"]);
    expect(w.snapshot!.bids.some((b) => b.lot === 26477)).toBe(false);
  });

  it("TLKM: angka dari fixture", () => {
    const s = parseOrderbookPage(document, sel).widgets[1]!.snapshot!;
    expect(s.last).toBe(2160);
    expect(s.bids[0]).toEqual({ freq: 61, lot: 20283, price: 2160 });
    expect(s.offers[0]).toEqual({ price: 2170, lot: 96199, freq: 156 });
    expect(foreignNet(s)).toBeCloseTo(149.1e9 - 227.6e9);
  });

  it("AQI & depth dari level tampil", () => {
    const s = parseOrderbookPage(document, sel).widgets[0]!.snapshot!;
    const bl = s.bids.reduce((a, b) => a + b.lot, 0), bf = s.bids.reduce((a, b) => a + b.freq, 0);
    const ol = s.offers.reduce((a, b) => a + b.lot, 0), of = s.offers.reduce((a, b) => a + b.freq, 0);
    expect(aqi(s)).toBeCloseTo(bl / bf / (ol / of));
    const b5 = 17756 + 67435 + 31527 + 66271 + 21529;
    const o5 = 58 + 15561 + 23993 + 27242 + 74624;
    expect(depthRatio(s)).toBeCloseTo(b5 / o5);
  });
});

describe("ketahanan parser", () => {
  it("selector judul rusak -> PARSER 0, tidak crash", () => {
    load();
    const r = parseOrderbookPage(document, { ...sel, headerLabels: ["Freq", "Lot", "Beli", "Jual", "Lot", "Freq"] });
    expect(r.parserPct).toBe(0);
    expect(r.widgets).toHaveLength(2);
    expect(r.widgets[0]!.errors[0]).toMatch(/judul/);
  });

  it("selector CSS tidak valid -> PARSER 0, tidak crash", () => {
    load();
    expect(parseOrderbookPage(document, { ...sel, codeInput: "input[[" }).parserPct).toBe(0);
  });

  it("satu sel rusak -> baris itu gagal, PARSER turun", () => {
    load(html.replace(">17,756<", ">abc<"));
    const r = parseOrderbookPage(document, sel);
    expect(r.rowsOk).toBe(23);
    expect(r.parserPct).toBe(96);
    expect(r.widgets[0]!.ok).toBe(false);
  });

  it("sisi offer kosong (mis. di ARA) tetap dihitung sukses", () => {
    load(html.replace(
      '<div color="#00ab6b">5,500</div><div color="#333333">58</div><div color="#8277F8">4</div>',
      '<div>-</div><div>-</div><div>-</div>',
    ));
    const w = parseOrderbookPage(document, sel).widgets[0]!;
    expect(w.ok).toBe(true);
    expect(w.snapshot!.offers).toHaveLength(11);
  });

  it("halaman tanpa widget -> parserPct null", () => {
    load("<html><body><p>kosong</p></body></html>");
    expect(parseOrderbookPage(document, sel).parserPct).toBeNull();
  });
});
