/**
 * Parser widget orderbook Stockbit (stockbit.com/orderbook). Hanya membaca DOM.
 *
 * Struktur yang terverifikasi (2026-11-13, lihat fixtures/orderbook-widgets.html):
 *   widget
 *   ├─ header: input[type=search][role=combobox] (value = kode), <p>harga</p>, <p>+25 (+0.46%)</p>
 *   └─ body
 *      ├─ statistik: pasangan [type=label] / [type=value] (Open, Prev, Lot, High, ARA, Val, ...)
 *      ├─ baris judul: Freq | Lot | Bid | Offer | Lot | Freq
 *      ├─ satu baris khusus 6 sel (arti belum diketahui -> TIDAK dipakai)
 *      ├─ grid: tiap baris = 2 bagian, bid [freq, lot, harga] & offer [harga, lot, freq]
 *      └─ footer: total freq bid, total lot bid, (kosong), total lot offer, total freq offer
 * Class CSS tidak dipakai karena berupa hash yang berubah-ubah.
 */
import { parseNumber } from "../core/normalize";
import type { BookLevel, BookSnapshot } from "../core/types";

export interface OrderbookSelectors {
  codeInput: string;
  statLabel: string;
  statValue: string;
  headerLabels: string[];
  maxAncestorDepth: number;
  statKeys: Record<string, string>;
}

export interface WidgetParse {
  code: string;
  ok: boolean;
  rowsTotal: number;
  rowsOk: number;
  errors: string[];
  snapshot: BookSnapshot | null;
  change?: { abs: number; pct: number } | null;
  /** Baris khusus di atas grid; disimpan mentah, artinya belum diverifikasi. */
  pinnedRowRaw?: string[];
}

export interface OrderbookParseResult {
  widgets: WidgetParse[];
  rowsTotal: number;
  rowsOk: number;
  /** Persentase baris yang berhasil di-parse (0–100); null jika tidak ada widget. */
  parserPct: number | null;
}

const EMPTY = new Set(["", "-", "—"]);

export function leafTexts(el: Element): string[] {
  if (el.children.length === 0) return [(el.textContent ?? "").trim()];
  const out: string[] = [];
  for (const c of Array.from(el.children)) out.push(...leafTexts(c));
  return out;
}

function isHeaderRow(el: Element, labels: string[]): boolean {
  if (el.children.length !== labels.length) return false;
  const t = leafTexts(el);
  return t.length === labels.length && t.every((x, i) => x === labels[i]);
}

function isLevelRow(el: Element): boolean {
  if (el.children.length !== 2) return false;
  return Array.from(el.children).every((half) => leafTexts(half).length === 3);
}

function commonAncestor(a: Element, b: Element): Element | null {
  const set = new Set<Element>();
  for (let x: Element | null = a; x; x = x.parentElement) set.add(x);
  for (let y: Element | null = b; y; y = y.parentElement) if (set.has(y)) return y;
  return null;
}

/** Anak langsung `ancestor` yang memuat `el`. */
function sectionOf(ancestor: Element, el: Element): Element | null {
  let x: Element | null = el;
  while (x && x.parentElement !== ancestor) x = x.parentElement;
  return x;
}

/** [a, b, c] -> level; null jika sisi kosong; "error" jika sebagian tidak terbaca. */
function parseSide(cells: string[], order: "bid" | "offer"): BookLevel | null | "error" {
  if (cells.every((c) => EMPTY.has(c))) return null;
  const [a, b, c] = cells.map((x) => parseNumber(x));
  if (a == null || b == null || c == null) return "error";
  return order === "bid" ? { freq: a, lot: b, price: c } : { price: a, lot: b, freq: c };
}

export function findWidgetRoot(input: Element, sel: OrderbookSelectors): Element | null {
  let x: Element | null = input.parentElement;
  for (let i = 0; x && i < sel.maxAncestorDepth; i++, x = x.parentElement) {
    if (x.querySelector(sel.statLabel)) {
      return x.querySelectorAll(sel.codeInput).length === 1 ? x : null;
    }
  }
  return null;
}

export function parseWidget(root: Element, code: string, sel: OrderbookSelectors, ts: number): WidgetParse {
  const res: WidgetParse = { code, ok: false, rowsTotal: 0, rowsOk: 0, errors: [], snapshot: null };
  const all = Array.from(root.querySelectorAll("*"));

  const header = all.find((e) => isHeaderRow(e, sel.headerLabels));
  if (!header) {
    res.errors.push("baris judul Freq|Lot|Bid|Offer|Lot|Freq tidak ditemukan");
    return res;
  }
  const rows = all.filter(
    (e) => isLevelRow(e) && (header.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );

  // Statistik
  const stats: Record<string, number | null> = {};
  root.querySelectorAll(sel.statLabel).forEach((lab) => {
    const key = sel.statKeys[(lab.textContent ?? "").trim()];
    const val = lab.nextElementSibling;
    if (key && val && val.matches(sel.statValue)) stats[key] = parseNumber(val.textContent);
  });

  // Harga terakhir & perubahan (area header tempat input kode berada)
  const input = root.querySelector(sel.codeInput);
  const headArea = input ? sectionOf(root, input) : null;
  let last: number | null = null;
  if (headArea) {
    const texts = leafTexts(headArea).filter((t) => t);
    last = texts.map((t) => parseNumber(t)).find((n) => n != null) ?? null;
    const ch = texts.map((t) => /([+-]?[\d.,]+)\s*\(([+-]?[\d.,]+)%\)/.exec(t)).find(Boolean);
    if (ch) {
      const abs = parseNumber(ch[1]);
      const pct = parseNumber(ch[2]);
      res.change = abs != null && pct != null ? { abs, pct } : null;
    }
  }

  // Level bid/offer
  const bids: BookLevel[] = [];
  const offers: BookLevel[] = [];
  for (const r of rows) {
    res.rowsTotal++;
    const [l, rr] = Array.from(r.children) as [Element, Element];
    const b = parseSide(leafTexts(l), "bid");
    const o = parseSide(leafTexts(rr), "offer");
    if (b === "error" || o === "error") {
      res.errors.push(`baris tidak terbaca: ${leafTexts(r).join(" | ")}`);
      continue;
    }
    if (b) bids.push(b);
    if (o) offers.push(o);
    res.rowsOk++;
  }

  // Baris khusus & footer: bagian sebelum/sesudah grid di dalam body
  let totals: BookSnapshot["totals"] = null;
  if (rows[0]) {
    const body = commonAncestor(header, rows[0]);
    if (body) {
      const sections = Array.from(body.children);
      const hIdx = sections.indexOf(sectionOf(body, header)!);
      const gIdx = sections.indexOf(sectionOf(body, rows[0])!);
      if (gIdx - hIdx === 2) res.pinnedRowRaw = leafTexts(sections[hIdx + 1]!);
      const footer = sections[gIdx + 1];
      if (footer) {
        const nums = leafTexts(footer).filter((t) => t).map((t) => parseNumber(t));
        if (nums.length === 4 && nums.every((n) => n != null)) {
          const [bidFreq, bidLot, offerLot, offerFreq] = nums as number[];
          totals = { bidFreq: bidFreq!, bidLot: bidLot!, offerLot: offerLot!, offerFreq: offerFreq! };
        }
      }
    }
  }

  if (res.rowsTotal === 0) res.errors.push("tidak ada baris bid/offer");
  res.snapshot = {
    ts, code, bids, offers, last,
    prev: stats.prev ?? null, open: stats.open ?? null, high: stats.high ?? null, low: stats.low ?? null,
    ara: stats.ara ?? null, arb: stats.arb ?? null, avg: stats.avg ?? null,
    totalLot: stats.totalLot ?? null, totalValue: stats.totalValue ?? null,
    foreignBuy: stats.foreignBuy ?? null, foreignSell: stats.foreignSell ?? null, freq: stats.freq ?? null,
    totals,
  };
  res.ok = res.rowsTotal > 0 && res.rowsOk === res.rowsTotal;
  return res;
}

/**
 * Parse semua widget orderbook di dokumen. Tidak pernah melempar error.
 * `memo` (opsional) mengingat kode terakhir per input: saat pengguna mengetik/membatalkan pencarian di
 * widget, isian sempat kosong padahal widget masih menampilkan emiten lama.
 */
export function parseOrderbookPage(doc: ParentNode, sel: OrderbookSelectors, ts = Date.now(), memo?: WeakMap<Element, string>): OrderbookParseResult {
  const widgets: WidgetParse[] = [];
  let inputs: Element[] = [];
  try {
    inputs = Array.from(doc.querySelectorAll(sel.codeInput));
  } catch {
    return { widgets, rowsTotal: 0, rowsOk: 0, parserPct: 0 };
  }
  for (const input of inputs) {
    const typed = ((input as HTMLInputElement).value ?? "").trim().toUpperCase();
    const focused = (input.ownerDocument?.activeElement ?? null) === input;
    // Saat input sedang difokus (pengguna mengetik), isiannya belum tentu emiten widget: pakai kode terakhir.
    const code = (focused || !typed ? memo?.get(input) : typed) ?? (focused ? "" : typed);
    if (!code) continue; // widget kosong (belum pilih emiten)
    if (typed && !focused) memo?.set(input, typed);
    try {
      const root = findWidgetRoot(input, sel);
      if (!root) {
        widgets.push({ code, ok: false, rowsTotal: 1, rowsOk: 0, errors: ["akar widget tidak ditemukan"], snapshot: null });
        continue;
      }
      const w = parseWidget(root, code, sel, ts);
      if (w.rowsTotal === 0) w.rowsTotal = 1; // widget tanpa baris dihitung gagal
      widgets.push(w);
    } catch (e) {
      widgets.push({ code, ok: false, rowsTotal: 1, rowsOk: 0, errors: [String(e)], snapshot: null });
    }
  }
  const rowsTotal = widgets.reduce((s, w) => s + w.rowsTotal, 0);
  const rowsOk = widgets.reduce((s, w) => s + w.rowsOk, 0);
  return { widgets, rowsTotal, rowsOk, parserPct: rowsTotal ? Math.round((100 * rowsOk) / rowsTotal) : null };
}
