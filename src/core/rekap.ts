/**
 * REKAP penutupan: gabungkan arus asing seluruh pasar (Movers Net Foreign Buy/Sell Stockbit)
 * dengan net gabungan broker institusi pilihan pengguna (Broker Analysis).
 * Kelompok: asing & institusi sama-sama beli / sama-sama jual / berlawanan / hanya satu pihak.
 * "Institusi" = broker yang dipilih pengguna (ESTIMASI: broker juga melayani nasabah non-institusi).
 */
import type { ForeignRow, InstRow } from "../content/parse-rekap";

export interface ForeignSnap {
  kind: "buy" | "sell";
  capturedAt: number;
  /** Hari bursa perkiraan (YYYY-MM-DD) saat diambil. */
  day: string;
  rows: ForeignRow[];
}
export interface InstSnap {
  capturedAt: number;
  /** Dari tombol tanggal halaman (mis. "13 Nov 26") -> YYYY-MM-DD; null bila tak terbaca. */
  day: string | null;
  dateText: string | null;
  brokers: { code: string; type: string | null }[];
  metric: string | null;
  investor: string | null;
  board: string | null;
  buys: InstRow[];
  sells: InstRow[];
  bothSides: string[];
}

export interface RekapRow {
  code: string;
  foreign: number | null;
  inst: number | null;
  instAvg: number | null;
  price: number | null;
  chgPct: number | null;
}
export interface Rekap {
  bothBuy: RekapRow[];
  bothSell: RekapRow[];
  divergent: RekapRow[];
  foreignOnlyBuy: RekapRow[];
  foreignOnlySell: RekapRow[];
  instOnlyBuy: RekapRow[];
  instOnlySell: RekapRow[];
  warnings: string[];
}

/** Broker ritel yang tidak boleh dihitung sebagai institusi (permintaan pengguna 2026-11-14). */
export const RETAIL_BROKERS = ["XL", "XC"];

export function buildRekap(fb: ForeignSnap | null, fs: ForeignSnap | null, inst: InstSnap | null): Rekap {
  const rows = new Map<string, RekapRow>();
  const get = (code: string) => {
    let r = rows.get(code);
    if (!r) rows.set(code, (r = { code, foreign: null, inst: null, instAvg: null, price: null, chgPct: null }));
    return r;
  };
  for (const x of fb?.rows ?? []) Object.assign(get(x.code), { foreign: x.amount, price: x.price, chgPct: x.chgPct });
  for (const x of fs?.rows ?? []) Object.assign(get(x.code), { foreign: -x.amount, price: x.price, chgPct: x.chgPct });
  for (const x of inst?.buys ?? []) Object.assign(get(x.code), { inst: x.value, instAvg: x.avg });
  for (const x of inst?.sells ?? []) {
    const r = get(x.code);
    // Bila muncul di dua sisi (mode Gross), gunakan selisihnya.
    r.inst = (r.inst ?? 0) - x.value;
    r.instAvg ??= x.avg;
  }
  const all = [...rows.values()];
  const sum = (r: RekapRow) => (r.foreign ?? 0) + (r.inst ?? 0);
  const pos = (n: number | null) => n !== null && n > 0;
  const neg = (n: number | null) => n !== null && n < 0;
  const byAbs = (k: "foreign" | "inst") => (a: RekapRow, b: RekapRow) => Math.abs(b[k] ?? 0) - Math.abs(a[k] ?? 0);

  const warnings: string[] = [];
  if (!fb) warnings.push("Asing beli belum diambil: buka Movers → tab Net Foreign Buy.");
  if (!fs) warnings.push("Asing jual belum diambil: buka Movers → tab Net Foreign Sell.");
  if (!inst) warnings.push("Institusi belum diambil: buka Broker Analysis dan pilih broker institusi.");
  if (fb && fs && fb.day !== fs.day) warnings.push(`Tanggal asing beli (${fb.day}) dan asing jual (${fs.day}) berbeda: ambil ulang.`);
  const fDay = fb?.day ?? fs?.day;
  if (inst?.day && fDay && inst.day !== fDay) warnings.push(`Tanggal institusi (${inst.dateText}) berbeda dengan data asing (${fDay}).`);
  const retail = inst?.brokers.filter((b) => RETAIL_BROKERS.includes(b.code)).map((b) => b.code) ?? [];
  if (retail.length) warnings.push(`Broker ritel ${retail.join(", ")} ikut terpilih di Broker Analysis: bukan institusi, hapus dari pilihan broker.`);
  if (inst?.bothSides.length) warnings.push(`Sakelar Net di Broker Analysis tampaknya mati (mode Gross): ${inst.bothSides.slice(0, 5).join(", ")} muncul di beli & jual.`);

  return {
    bothBuy: all.filter((r) => pos(r.foreign) && pos(r.inst)).sort((a, b) => sum(b) - sum(a)),
    bothSell: all.filter((r) => neg(r.foreign) && neg(r.inst)).sort((a, b) => sum(a) - sum(b)),
    divergent: all.filter((r) => (pos(r.foreign) && neg(r.inst)) || (neg(r.foreign) && pos(r.inst))).sort((a, b) => Math.abs(sum(b)) - Math.abs(sum(a))),
    foreignOnlyBuy: all.filter((r) => pos(r.foreign) && r.inst === null).sort(byAbs("foreign")),
    foreignOnlySell: all.filter((r) => neg(r.foreign) && r.inst === null).sort(byAbs("foreign")),
    instOnlyBuy: all.filter((r) => pos(r.inst) && r.foreign === null).sort(byAbs("inst")),
    instOnlySell: all.filter((r) => neg(r.inst) && r.foreign === null).sort(byAbs("inst")),
    warnings,
  };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, agt: 8,
  sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12,
};
/** "13 Nov 26" / "13 Nov 2026" -> "2026-11-13". */
export function parseShortDate(s: string | null): string | null {
  const m = /^(\d{1,2}) (\S{3})\S* (\d{2}|\d{4})$/.exec(s?.trim() ?? "");
  if (!m) return null;
  const mo = MONTHS[m[2]!.toLowerCase()];
  if (!mo) return null;
  const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${String(mo).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
}

/** "13 Nov 26" -> {from, to} sama; "07 Nov 26–13 Nov 26" -> rentang. */
export function parseDateRange(s: string | null): { from: string; to: string } | null {
  const parts = (s ?? "").split(/\s*[–-]\s*/);
  const a = parseShortDate(parts[0] ?? null);
  const b = parts.length > 1 ? parseShortDate(parts[1] ?? null) : a;
  return a && b ? { from: a, to: b } : null;
}

const CSV_COLS =["kelompok", "kode", "asing_net", "inst_net", "avg_inst", "harga", "chg_pct"];
export function rekapToCSV(
  r: Rekap,
  totals?: { foreignBuy: number; foreignSell: number; instBuy: number; instSell: number },
  label?: string,
): string {
  const groups: [string, RekapRow[]][] = [
    ["asing+inst beli", r.bothBuy], ["asing+inst jual", r.bothSell], ["berlawanan", r.divergent],
    ["asing beli saja", r.foreignOnlyBuy], ["asing jual saja", r.foreignOnlySell],
    ["inst beli saja", r.instOnlyBuy], ["inst jual saja", r.instOnlySell],
  ];
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = groups.flatMap(([g, rows]) => rows.map((x) => [g, x.code, x.foreign, x.inst, x.instAvg, x.price, x.chgPct].map(cell).join(",")));
  const tail = totals
    ? [
        ["TOTAL", "asing net beli", totals.foreignBuy, "", "", "", ""], ["TOTAL", "asing net jual", -totals.foreignSell, "", "", "", ""],
        ["TOTAL", "inst net beli", "", totals.instBuy, "", "", ""], ["TOTAL", "inst net jual", "", -totals.instSell, "", "", ""],
      ].map((x) => x.map(cell).join(","))
    : [];
  const head = label ? [`# ${label.replace(/\n/g, " ")}`] : [];
  return [...head, CSV_COLS.join(","), ...lines, ...tail].join("\n") + "\n";
}
