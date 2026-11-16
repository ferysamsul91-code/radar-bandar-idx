/**
 * Parser panel "Running Trade" Stockbit (panel samping di stockbit.com/orderbook). Hanya membaca DOM.
 *
 * Struktur terverifikasi (2026-11-13, lihat fixtures/running-trade.html):
 *   #running-trade table
 *     thead: Time | Code | Price | Action | Lot | Buyer | Seller | Val | Market
 *     tbody tr (terbaru di atas):
 *       16:27:10 | <a>BBRI</a> | <p>3,042 (+2.81%)</p> | <p>Buy</p> | 11,404 |
 *       <div>AK <span>[F]</span></div> | <div>AK <span>[F]</span></div> | <p>3.5B</p> | NG
 * Kolom dipetakan lewat teks judul, jadi urutan kolom boleh berubah.
 * Lot bisa pecahan di pasar NG (mis. "0.35"); Val = harga × lot × 100 (dicek ke fixture).
 */
import { parseNumber, parseTimeOfDay } from "../core/normalize";
import type { Board, InvestorType } from "../core/types";

export interface RunningTradeSelectors {
  container: string;
  columns: Record<string, string>; // teks judul -> nama field
}

export interface RawTrade {
  time: string;
  code: string;
  price: number;
  chgPct: number | null;
  /** Label Action dari layar: "B" (Buy) / "S" (Sell) / null. */
  action: "B" | "S" | null;
  lot: number;
  buyer?: string;
  buyerType?: InvestorType;
  seller?: string;
  sellerType?: InvestorType;
  displayValue: number | null;
  board: Board;
  /** Kunci baris: "KODE|NOMOR_TRADE" bila data-row-key tersedia (unik), selain itu gabungan isi baris. */
  key: string;
  /** Waktu tepat dari data-row-key (epoch ms), bila tersedia. */
  epochMs?: number;
  /** Nomor trade bursa dari data-row-key, bila tersedia. */
  tradeNo?: number;
}

export interface RunningTradeParse {
  found: boolean;
  rows: RawTrade[]; // urutan layar: terbaru di atas
  rowsTotal: number;
  rowsOk: number;
  /** false jika tabel tidak urut terbaru-di-atas (mis. user mengurutkan Time naik). */
  newestFirst: boolean;
  /** Apakah kode broker & D/F tampil di baris yang terbaca. */
  brokerVisible: boolean;
  errors: string[];
}

const BROKER_RE = /^([A-Z0-9]{1,4})?\s*(?:\[([DF])\])?$/;

function parseBroker(txt: string): { code?: string; type?: InvestorType } {
  const t = txt.replace(/\s+/g, " ").trim();
  if (!t || t === "-" || t === "—") return {};
  const m = BROKER_RE.exec(t);
  if (!m) return {};
  return { code: m[1], type: m[2] as InvestorType | undefined };
}

function parsePriceCell(txt: string): { price: number | null; chgPct: number | null } {
  const m = /^([\d.,]+)\s*(?:\(([+-]?[\d.,]+)%\))?/.exec(txt.trim());
  if (!m) return { price: null, chgPct: null };
  return { price: parseNumber(m[1]), chgPct: m[2] ? parseNumber(m[2]) : null };
}

export function parseRunningTrade(doc: ParentNode, sel: RunningTradeSelectors): RunningTradeParse {
  const res: RunningTradeParse = { found: false, rows: [], rowsTotal: 0, rowsOk: 0, newestFirst: true, brokerVisible: false, errors: [] };
  let tables: Element[] = [];
  try {
    tables = Array.from(doc.querySelectorAll(`${sel.container} table`));
  } catch {
    res.errors.push("selector container tidak valid");
    return res;
  }
  if (!tables.length) return res; // panel Running Trade tertutup
  res.found = true;
  // Saat sesi live, judul & isi ada di DUA tabel (antd fixed header); setelah tutup bisa satu tabel (dicek 2026-11-13/16).
  const headTable = tables.find((x) => x.querySelector("thead th")) ?? tables[0]!;
  const table = tables.find((x) => x.querySelector("tbody tr[data-row-key], tbody tr td")) ?? headTable;

  // Peta kolom dari judul
  const ths = Array.from(headTable.querySelectorAll("thead th"));
  const col: Record<string, number> = {};
  ths.forEach((th, i) => {
    const f = sel.columns[(th.textContent ?? "").trim()];
    if (f) col[f] = i;
  });
  for (const req of ["time", "code", "price", "lot"]) {
    if (col[req] === undefined) res.errors.push(`kolom "${req}" tidak ditemukan di judul tabel`);
  }
  const body = table.querySelector("tbody");
  if (!body) return res;
  // Baris pengukur antd (aria-hidden, kosong) bukan data.
  const trs = Array.from(body.querySelectorAll(":scope > tr")).filter((tr) => tr.getAttribute("aria-hidden") !== "true" && (tr.textContent ?? "").trim() !== "");
  res.rowsTotal = trs.length;
  if (res.errors.length) return res;

  const cellsOf = (tr: Element) => Array.from(tr.querySelectorAll(":scope > td"));
  const cellText = (tr: Element, f: string) => {
    const i = col[f];
    return i === undefined ? "" : (cellsOf(tr)[i]?.textContent ?? "").replace(/\s+/g, " ").trim();
  };

  let prevSecs = Infinity;
  for (const tr of trs) {
    const time = cellText(tr, "time");
    const secs = parseTimeOfDay(time);
    const code = cellText(tr, "code").toUpperCase();
    const { price, chgPct } = parsePriceCell(cellText(tr, "price"));
    const lot = parseNumber(cellText(tr, "lot"));
    const actionTxt = cellText(tr, "action").toLowerCase();
    const marketTxt = cellText(tr, "market").toUpperCase();
    const board: Board | null = col.market === undefined ? "RG" : (["RG", "NG", "TN"].includes(marketTxt) ? (marketTxt as Board) : null);

    if (secs == null || !/^[A-Z0-9-]{2,8}$/.test(code) || price == null || lot == null || board == null) {
      res.errors.push(`baris tidak terbaca: ${cellsOf(tr).map((c) => (c.textContent ?? "").trim()).join(" | ")}`);
      continue;
    }
    if (secs > prevSecs) res.newestFirst = false;
    prevSecs = secs;

    const b = parseBroker(cellText(tr, "buyer"));
    const s = parseBroker(cellText(tr, "seller"));
    if (b.code || s.code) res.brokerVisible = true;
    const action = actionTxt === "buy" ? "B" : actionTxt === "sell" ? "S" : null;
    // data-row-key = "KODE|NOMOR_TRADE|EPOCH_DETIK" (dicek live 2026-11-16): kunci unik & waktu tepat.
    const rk = /^([A-Z0-9-]+)\|(\d+)\|(\d{9,11})$/.exec(tr.getAttribute("data-row-key") ?? "");
    const row: RawTrade = {
      time, code, price, chgPct, action, lot,
      buyer: b.code, buyerType: b.type, seller: s.code, sellerType: s.type,
      displayValue: parseNumber(cellText(tr, "value")),
      board,
      key: rk && rk[1] === code ? `${code}|${rk[2]}` : [time, code, price, lot, action ?? "", b.code ?? "", b.type ?? "", s.code ?? "", s.type ?? "", board].join("|"),
      ...(rk && rk[1] === code ? { tradeNo: Number(rk[2]), epochMs: Number(rk[3]) * 1000 } : {}),
    };
    res.rows.push(row);
    res.rowsOk++;
  }
  return res;
}
