/**
 * Parser sumber REKAP penutupan (hanya membaca DOM yang dibuka pengguna):
 *
 * 1) Panel "Movers" Stockbit (ikon api di rel kanan), tab Net Foreign Buy / Net Foreign Sell.
 *    Terverifikasi 2026-11-14 (fixtures/movers-net-foreign-*.html):
 *    th#symbol | th | th#netForeignBuy (atau #netForeignSell) | th | th#value | th | th#volume | th | th#freq | th | th#price
 *    td: <img alt="ASII"><span>ASII</span> | "" | "78.63B" | "" | ... | <span>5,500</span><span>(+0.92%)</span>
 *    Nilai jual ditulis positif (140.89B = net jual 140,89 M).
 *
 * 2) Halaman Broker Analysis (stockbit.com/broker-analysis/broker), mode Broker Activity.
 *    Terverifikasi 2026-11-14 (fixtures/broker-analysis.html):
 *    chip broker: <span type="foreign|local|bumn">AK</span> + ikon [aria-label=close]
 *    tombol: "Value" | "All Investor" | "Regular" | "13 Nov 26"
 *    tabel "Top Buy" / "Top Sell": Symbol | Last 7D | B.Val | B.Lot | B.Freq | B.Avg (S.* untuk jual)
 *    Hasil = net GABUNGAN broker terpilih (dicek: BBCA 70.9B = beli KZ+BK+AK − jual ZP+RX).
 *    Status sakelar "Net" tidak terbaca dari DOM.
 */
import { parseNumber, parsePercent } from "../core/normalize";

export interface ForeignRow {
  code: string;
  /** Selalu positif: besar net beli (tab Buy) atau net jual (tab Sell). */
  amount: number;
  value: number | null;
  price: number | null;
  chgPct: number | null;
}
export interface MoversParse {
  found: boolean;
  kind: "buy" | "sell" | null;
  rows: ForeignRow[];
  rowsTotal: number;
  rowsOk: number;
}

const leafText = (el: Element | null | undefined) => el?.textContent?.trim() ?? "";
const CODE = /^[A-Z0-9]{2,7}$/;

/** Panel Movers yang sedang menampilkan tab Net Foreign Buy/Sell. Tab lain -> found tanpa kind. */
export function parseMoversForeign(doc: ParentNode): MoversParse {
  const empty: MoversParse = { found: false, kind: null, rows: [], rowsTotal: 0, rowsOk: 0 };
  try {
    const head = doc.querySelector("th#netForeignBuy, th#netForeignSell");
    if (!head) return { ...empty, found: !!doc.querySelector("#movers-tab-menu-list") };
    const table = head.closest("table");
    if (!table) return empty;
    const kind = head.id === "netForeignBuy" ? "buy" : "sell";
    const ths = [...table.querySelectorAll("thead th")];
    const col = (id: string) => ths.findIndex((t) => t.id === id);
    const iSym = col("symbol");
    const iAmt = ths.indexOf(head);
    const iVal = col("value");
    const iPrice = col("price");
    const out: MoversParse = { found: true, kind, rows: [], rowsTotal: 0, rowsOk: 0 };
    for (const tr of table.querySelectorAll("tbody tr")) {
      const td = [...tr.querySelectorAll(":scope > td")];
      out.rowsTotal++;
      const symCell = td[iSym];
      const code = (symCell?.querySelector("img")?.getAttribute("alt") ?? leafText(symCell)).trim().toUpperCase();
      const amount = parseNumber(leafText(td[iAmt]));
      if (!CODE.test(code) || amount === null) continue;
      const spans = td[iPrice]?.querySelectorAll("span") ?? [];
      out.rows.push({
        code, amount: Math.abs(amount),
        value: iVal >= 0 ? parseNumber(leafText(td[iVal])) : null,
        price: parseNumber(leafText(spans[0])),
        chgPct: parsePercent(leafText(spans[1]).replace(/[()]/g, "")),
      });
      out.rowsOk++;
    }
    return out;
  } catch {
    return empty;
  }
}

export interface InstRow {
  code: string;
  value: number;
  lot: number | null;
  freq: number | null;
  avg: number | null;
}
export interface BrokerAnalysisParse {
  found: boolean;
  brokers: { code: string; type: string | null }[];
  dateText: string | null;
  metric: string | null;
  investor: string | null;
  board: string | null;
  buys: InstRow[];
  sells: InstRow[];
  /** Emiten yang muncul di Top Buy & Top Sell sekaligus: tanda sakelar Net mati (mode Gross). */
  bothSides: string[];
  rowsTotal: number;
  rowsOk: number;
}

function readSideTable(table: Element, prefix: "B" | "S"): { rows: InstRow[]; total: number } {
  const heads = [...table.querySelectorAll("thead th")].map((t) => leafText(t));
  const idx = (h: string) => heads.indexOf(h);
  const iSym = idx("Symbol");
  const iVal = idx(`${prefix}.Val`);
  const iLot = idx(`${prefix}.Lot`);
  const iFreq = idx(`${prefix}.Freq`);
  const iAvg = idx(`${prefix}.Avg`);
  const rows: InstRow[] = [];
  let total = 0;
  for (const tr of table.querySelectorAll("tbody tr")) {
    const td = [...tr.querySelectorAll(":scope > td")];
    total++;
    const symCell = td[iSym];
    const code = (symCell?.querySelector("img")?.getAttribute("alt") ?? leafText(symCell)).trim().toUpperCase();
    const value = parseNumber(leafText(td[iVal]));
    if (!CODE.test(code) || value === null) continue;
    rows.push({ code, value, lot: parseNumber(leafText(td[iLot])), freq: parseNumber(leafText(td[iFreq])), avg: parseNumber(leafText(td[iAvg])) });
  }
  return { rows, total };
}

export function parseBrokerAnalysis(doc: ParentNode): BrokerAnalysisParse {
  const empty: BrokerAnalysisParse = { found: false, brokers: [], dateText: null, metric: null, investor: null, board: null, buys: [], sells: [], bothSides: [], rowsTotal: 0, rowsOk: 0 };
  try {
    const tables = [...doc.querySelectorAll("table")];
    const hasHead = (t: Element, h: string) => [...t.querySelectorAll("thead th")].some((x) => leafText(x) === h);
    const buyT = tables.find((t) => hasHead(t, "Symbol") && hasHead(t, "B.Val"));
    const sellT = tables.find((t) => hasHead(t, "Symbol") && hasHead(t, "S.Val"));
    if (!buyT && !sellT) return empty;

    const brokers: BrokerAnalysisParse["brokers"] = [];
    for (const s of doc.querySelectorAll("span[type]")) {
      const code = leafText(s);
      if (!/^[A-Z0-9]{2}$/.test(code) || s.childElementCount) continue;
      let chip: Element | null = s;
      for (let i = 0; chip && i < 3; i++) chip = chip.parentElement;
      if (!chip?.querySelector('[aria-label="close"]')) continue;
      if (!brokers.some((b) => b.code === code)) brokers.push({ code, type: s.getAttribute("type") });
    }

    // Filter (Value / All Investor / Regular) = button[role=combobox] (dicek live 2026-11-14). Tombol lain seperti
    // tab "All/Local/BUMN/Foreign" di dalam pemilih broker tidak boleh terbaca sebagai filter investor.
    const combos = [...doc.querySelectorAll('[role="combobox"]')].map((b) => leafText(b)).filter(Boolean);
    const btn = [...doc.querySelectorAll("button")].map((b) => leafText(b));
    const fromBtn = (re: RegExp) => btn.find((t) => re.test(t)) ?? null;
    const pick = (re: RegExp) => (combos.length ? combos.find((t) => re.test(t)) ?? null : fromBtn(re));
    const b = buyT ? readSideTable(buyT, "B") : { rows: [], total: 0 };
    const s = sellT ? readSideTable(sellT, "S") : { rows: [], total: 0 };
    const sellCodes = new Set(s.rows.map((r) => r.code));
    return {
      found: true, brokers,
      // Satu tanggal ("13 Nov 26") atau rentang ("07 Nov 26–13 Nov 26", dicek live 2026-11-14).
      dateText: fromBtn(/^\d{1,2} \S{3} \d{2,4}(\s*[–-]\s*\d{1,2} \S{3} \d{2,4})?$/),
      metric: pick(/^(Value|Volume|Freq|Frequency)$/i),
      investor: pick(/investor|^foreign$|^domestic$/i),
      board: pick(/^(regular|negotiated?|negosiasi|cash|tunai|all market)$/i),
      buys: b.rows, sells: s.rows,
      bothSides: b.rows.filter((r) => sellCodes.has(r.code)).map((r) => r.code),
      rowsTotal: b.total + s.total, rowsOk: b.rows.length + s.rows.length,
    };
  } catch {
    return empty;
  }
}
