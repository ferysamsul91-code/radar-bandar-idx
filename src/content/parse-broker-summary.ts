/**
 * Parser widget "Broker Summary" Stockbit (kolom kanan stockbit.com/symbol/KODE). Hanya membaca DOM.
 *
 * Struktur terverifikasi (2026-11-14, lihat fixtures/broker-summary.html):
 *   <p>Broker Summary</p>
 *   tanggal: <button><span>13 Nov 26</span></button>
 *   filter: <span title="All Investor">, <span title="Regular">, <span title="Net">
 *   tabel judul (thead terpisah): BY | B.val | B.lot | B.avg | SL | S.val | S.lot | S.avg
 *   tbody tr[data-row-key]: <td><p type="foreign|local|bumn">KZ</p></td> <td><p type="up">185.2B</p></td> ...
 * Atribut type pada kode broker = klasifikasi broker dari Stockbit (kepemilikan broker,
 * BUKAN kebangsaan investor; filter investor ada di dropdown "All Investor").
 */
import { parseNumber } from "../core/normalize";

export type BrokerOwner = "foreign" | "local" | "bumn";

export interface BrokerSummarySelectors {
  title: string;
  maxAncestorDepth: number;
  brokerTypeAttr: string;
  columns: Record<string, string>;
}

export interface BsSide {
  broker: string;
  owner: BrokerOwner | null;
  value: number;
  lot: number | null;
  avg: number | null;
}

export interface BrokerSummaryParse {
  found: boolean;
  dateText: string | null;
  investor: string | null;
  board: string | null;
  mode: string | null;
  buyers: BsSide[];
  sellers: BsSide[];
  rowsTotal: number;
  rowsOk: number;
  errors: string[];
}

const EMPTY: BrokerSummaryParse = { found: false, dateText: null, investor: null, board: null, mode: null, buyers: [], sellers: [], rowsTotal: 0, rowsOk: 0, errors: [] };
const OWNERS: readonly string[] = ["foreign", "local", "bumn"];

/** Judul "Broker Summary" bisa muncul di beberapa tempat; pakai yang leluhurnya berisi tabel. */
function findRoot(doc: ParentNode, sel: BrokerSummarySelectors): Element | null {
  for (const title of doc.querySelectorAll("p")) {
    if (title.textContent?.trim() !== sel.title) continue;
    let el: Element | null = title;
    for (let i = 0; el && i < sel.maxAncestorDepth; i++) {
      el = el.parentElement;
      if (el?.querySelector("thead") && el.querySelector("tbody tr[data-row-key]")) return el;
    }
  }
  return null;
}

/** Klasifikasi teks filter dropdown (urutan di layar tidak diandalkan). */
function readFilters(root: Element) {
  let investor: string | null = null;
  let board: string | null = null;
  let mode: string | null = null;
  for (const s of root.querySelectorAll("span[title]")) {
    const t = s.getAttribute("title")?.trim() ?? "";
    if (!t) continue;
    if (/investor|foreign|domestic|asing|lokal/i.test(t)) investor ??= t;
    else if (/^(net|gross)$/i.test(t)) mode ??= t;
    else board ??= t;
  }
  return { investor, board, mode };
}

export function parseBrokerSummary(doc: ParentNode, sel: BrokerSummarySelectors): BrokerSummaryParse {
  try {
    const root = findRoot(doc, sel);
    if (!root) return { ...EMPTY, errors: [] };
    const heads = [...root.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
    const idx: Record<string, number> = {};
    heads.forEach((h, i) => {
      const f = sel.columns[h];
      if (f && idx[f] === undefined) idx[f] = i;
    });
    const missing = Object.values(sel.columns).filter((f) => idx[f] === undefined);
    if (missing.length) return { ...EMPTY, found: true, errors: [`kolom tidak ditemukan: ${missing.join(", ")}`] };

    const dateText = [...root.querySelectorAll("button span")].map((s) => s.textContent?.trim() ?? "").find((t) => /^\d{1,2} \S{3,} \d{2,4}$/.test(t)) ?? null;
    const out: BrokerSummaryParse = { ...EMPTY, found: true, dateText, ...readFilters(root), buyers: [], sellers: [], errors: [] };

    const side = (cells: Element[], b: string, v: string, l: string, a: string): BsSide | null | "bad" => {
      const codeEl = cells[idx[b]!]?.querySelector("p") ?? cells[idx[b]!];
      const broker = codeEl?.textContent?.trim() ?? "";
      if (!broker) return null; // sisi ini kosong pada baris ini
      const value = parseNumber(cells[idx[v]!]?.textContent);
      if (!/^[A-Z0-9]{2}$/.test(broker) || value === null) return "bad";
      const ownerRaw = codeEl?.getAttribute(sel.brokerTypeAttr) ?? "";
      return {
        broker, value,
        owner: OWNERS.includes(ownerRaw) ? (ownerRaw as BrokerOwner) : null,
        lot: parseNumber(cells[idx[l]!]?.textContent), avg: parseNumber(cells[idx[a]!]?.textContent),
      };
    };

    for (const tr of root.querySelectorAll("tbody tr[data-row-key]")) {
      const cells = [...tr.querySelectorAll(":scope > td")];
      out.rowsTotal++;
      const b = side(cells, "buyer", "buyVal", "buyLot", "buyAvg");
      const s = side(cells, "seller", "sellVal", "sellLot", "sellAvg");
      if (b === "bad" || s === "bad" || (!b && !s)) {
        out.errors.push(`baris ${tr.getAttribute("data-row-key")} tidak terbaca`);
        continue;
      }
      out.rowsOk++;
      if (b) out.buyers.push(b);
      if (s) out.sellers.push(s);
    }
    return out;
  } catch (e) {
    return { ...EMPTY, errors: [String(e)] };
  }
}

/** Kode emiten dari URL /symbol/KODE. */
export function symbolFromPath(path: string): string | null {
  const m = /^\/symbol\/([A-Za-z0-9]{2,7})(?:[/?#]|$)/.exec(path);
  return m ? m[1]!.toUpperCase() : null;
}
