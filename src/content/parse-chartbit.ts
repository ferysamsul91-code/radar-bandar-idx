/**
 * Parser "Table view" TradingView di Chartbit Stockbit (stockbit.com/symbol/KODE/chartbit).
 * Hanya membaca DOM yang ditampilkan pengguna (klik kanan grafik -> Table view).
 * Terverifikasi 2026-11-14 (fixtures/chartbit-table-medc.html), di dalam iframe#tradingview_* (blob:, origin sama):
 *   table[role=grid]
 *     thead tr1: th "Date · 1D" (rowspan 2) | th "MEDC · IDX" (colspan 5) | th[data-overflow-tooltip-text="Stoch RSI 14 14 3 3"] (colspan 2)
 *     thead tr2: Open | High | Low | Close | Change | %K | %D
 *     tbody tr: td[role=rowheader] "Fri 13 Nov '26" | 1,230 | 1,235 | 1,200 | 1,230 | +20 (+1.65%) | 39.3 | 20.8
 * Tabel virtual: hanya ±40 baris yang dirender; menggulir tabel memunculkan baris lain.
 */
import { parseNumber } from "../core/normalize";

export interface ChartBar {
  /** "YYYY-MM-DD" atau "YYYY-MM-DD HH:MM" (timeframe intraday). */
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  /** Nilai indikator per kolom, kunci "NAMA INDIKATOR|KOLOM" (mis. "Stoch RSI 14 14 3 3|%K"). */
  ind: Record<string, number | null>;
}

export interface ChartTableParse {
  found: boolean;
  symbol: string | null;
  timeframe: string | null;
  indicators: string[];
  /** Urutan seperti di layar (terbaru di atas). */
  bars: ChartBar[];
  rowsTotal: number;
  rowsOk: number;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "Fri 13 Nov '26" -> "2026-11-13"; "13 Nov '26 09:30" -> "2026-11-13 09:30". */
export function parseTvDate(s: string): string | null {
  const m = /(\d{1,2}) ([A-Za-z]{3})[a-z]* '?(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  const mo = MONTHS[m[2]!.toLowerCase()];
  if (!mo) return null;
  const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = `${y}-${String(mo).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return m[4] ? `${d} ${m[4].padStart(2, "0")}:${m[5]}` : d;
}

/** Cari tabel Table view di dokumen ini atau di iframe TradingView (origin sama). */
export function findChartTable(doc: Document): HTMLTableElement | null {
  const direct = doc.querySelector<HTMLTableElement>("table[role=grid]");
  if (direct) return direct;
  for (const f of doc.querySelectorAll<HTMLIFrameElement>("iframe[id^=tradingview_]")) {
    try {
      const t = f.contentDocument?.querySelector<HTMLTableElement>("table[role=grid]");
      if (t) return t;
    } catch { /* origin berbeda: tidak bisa dibaca */ }
  }
  return null;
}

const text = (e: Element | null | undefined) => (e?.textContent ?? "").replace(/\s+/g, " ").trim();

export function parseChartTable(doc: Document): ChartTableParse {
  const empty: ChartTableParse = { found: false, symbol: null, timeframe: null, indicators: [], bars: [], rowsTotal: 0, rowsOk: 0 };
  try {
    const table = findChartTable(doc);
    if (!table) return empty;
    const hr = [...table.querySelectorAll("thead tr")];
    if (hr.length < 2) return { ...empty, found: true };
    const top = [...hr[0]!.children];
    const sub = [...hr[1]!.children].map(text);
    const dateHead = text(top[0]);
    const timeframe = /·\s*(\S+)/.exec(dateHead)?.[1] ?? null;
    // Petakan kolom anak ke grup (simbol / indikator) memakai colspan.
    const cols: { group: string; name: string }[] = [];
    let k = 0;
    for (const g of top.slice(1)) {
      const name = (g.querySelector("[data-overflow-tooltip-text]")?.getAttribute("data-overflow-tooltip-text") ?? text(g)).trim();
      const span = Number(g.getAttribute("colspan") ?? 1) || 1;
      for (let i = 0; i < span; i++) cols.push({ group: name, name: sub[k++] ?? "" });
    }
    const idx = (n: string) => cols.findIndex((c) => c.name === n);
    const iO = idx("Open"), iH = idx("High"), iL = idx("Low"), iC = idx("Close");
    if ([iO, iH, iL, iC].some((i) => i < 0)) return { ...empty, found: true };
    const priceGroup = cols[iC]!.group;
    const symbol = priceGroup.split("·")[0]!.trim().toUpperCase() || null;
    const indCols = cols.map((c, i) => ({ ...c, i })).filter((c) => c.group !== priceGroup);
    const indicators = indCols.map((c) => `${c.group}|${c.name}`);

    const out: ChartTableParse = { found: true, symbol, timeframe, indicators, bars: [], rowsTotal: 0, rowsOk: 0 };
    for (const tr of table.querySelectorAll("tbody tr")) {
      const cells = [...tr.children];
      if (!cells.length || !text(tr)) continue; // baris pengisi tabel virtual
      out.rowsTotal++;
      const t = parseTvDate(text(cells[0]));
      const v = (i: number) => parseNumber(text(cells[i + 1]));
      const o = v(iO), h = v(iH), l = v(iL), c = v(iC);
      if (!t || o === null || h === null || l === null || c === null) continue;
      const ind: Record<string, number | null> = {};
      for (const ic of indCols) ind[`${ic.group}|${ic.name}`] = v(ic.i);
      out.bars.push({ t, o, h, l, c, ind });
      out.rowsOk++;
    }
    return out;
  } catch {
    return empty;
  }
}
