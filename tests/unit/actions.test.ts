// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import selectors from "../../src/config/selectors.json";
import { fillCodeSearch } from "../../src/content/actions";
import { parseOrderbookPage, type OrderbookSelectors } from "../../src/content/parse-orderbook";

const sel = selectors.orderbook as OrderbookSelectors;
const FIX = readFileSync(resolve(import.meta.dirname, "../../fixtures/orderbook-widgets.html"), "utf8");
/** Kotak pencarian global Stockbit (atribut dari DOM asli 2026-11-14). */
const GLOBAL = `<div><input autocomplete="off" placeholder="Search for brand, symbol or username..." data-cy="top-navbar-search-input-desktop" type="search" role="combobox" id="rc_select_0"></div>`;
const widgetInputs = () => [...document.querySelectorAll<HTMLInputElement>('input[type=search][role=combobox]')].slice(1);

describe("klik kode -> isi kotak kode widget orderbook", () => {
  beforeEach(() => {
    document.body.innerHTML = GLOBAL + FIX;
  });

  it("kotak pencarian global tidak ikut terbaca sebagai widget", () => {
    const r = parseOrderbookPage(document, sel, 1000);
    expect(r.widgets.map((w) => w.code)).toEqual(["BBCA", "TLKM"]);
    document.querySelector<HTMLInputElement>("#rc_select_0")!.value = "UNVR";
    expect(parseOrderbookPage(document, sel, 1000).widgets.map((w) => w.code)).toEqual(["BBCA", "TLKM"]);
  });

  it("mengisi widget pertama (bukan kotak global) dan memicu event input, tanpa Enter", () => {
    const [w0] = widgetInputs();
    let fired = 0;
    let keys = 0;
    w0!.addEventListener("input", () => fired++);
    w0!.addEventListener("keydown", () => keys++);
    expect(fillCodeSearch(document, sel, "GOTO", null)).toBe(true);
    expect(document.querySelector<HTMLInputElement>("#rc_select_0")!.value).toBe("");
    expect(w0!.value).toBe("GOTO");
    expect(fired).toBe(1);
    expect(keys).toBe(0);
  });

  it("prioritas: widget yang terakhir diklik, lalu widget kosong", () => {
    const [w0, w1] = widgetInputs();
    fillCodeSearch(document, sel, "ANTM", w1!);
    expect(w1!.value).toBe("ANTM");
    w1!.value = "";
    fillCodeSearch(document, sel, "MDKA", null);
    expect(w1!.value).toBe("MDKA");
    expect(w0!.value).toBe("BBCA");
  });

  it("input global sebagai 'terakhir diklik' diabaikan", () => {
    const g = document.querySelector<HTMLInputElement>("#rc_select_0")!;
    fillCodeSearch(document, sel, "ANTM", g);
    expect(g.value).toBe("");
    expect(widgetInputs()[0]!.value).toBe("ANTM");
  });

  it("isian widget dikosongkan (pengguna batal) -> parser tetap pakai kode terakhir", () => {
    const memo = new WeakMap<Element, string>();
    expect(parseOrderbookPage(document, sel, 1000, memo).widgets.map((w) => w.code)).toEqual(["BBCA", "TLKM"]);
    widgetInputs()[0]!.value = "";
    expect(parseOrderbookPage(document, sel, 1000, memo).widgets.map((w) => w.code)).toEqual(["BBCA", "TLKM"]);
    expect(parseOrderbookPage(document, sel, 1000).widgets.map((w) => w.code)).toEqual(["TLKM"]);
  });

  it("tanpa widget orderbook -> false", () => {
    document.body.innerHTML = GLOBAL;
    expect(fillCodeSearch(document, sel, "GOTO", null)).toBe(false);
  });
});
