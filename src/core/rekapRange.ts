/**
 * REKAP per rentang tanggal.
 * - Riwayat disimpan per hari bursa: asing (Movers, hanya hari berjalan -> terkumpul dari hari ke hari)
 *   dan institusi (Broker Analysis; Stockbit juga bisa langsung menampilkan RENTANG tanggal).
 * - Asing per rentang = jumlah net harian yang tersimpan (top 50 per hari; emiten di luar daftar dianggap 0 -> ESTIMASI).
 * - Institusi per rentang = snapshot Broker Analysis dengan rentang PERSIS sama (dihitung Stockbit),
 *   atau jumlah snapshot harian yang tersimpan.
 */
import { buildRekap, type ForeignSnap, type InstSnap, type Rekap } from "./rekap";
import type { ForeignRow, InstRow } from "../content/parse-rekap";
import type { BrokerNet } from "./instTrace";
import type { LiveRec, LiveSumRow } from "./liveTrace";

/** Net JEJAK INSTITUSI harian (dari running trade), disimpan di "rbInstH:YYYY-MM-DD". */
export interface TraceDay {
  day: string;
  savedAt: number;
  nets: BrokerNet[];
}

export interface RekapHistory {
  fbuy: Record<string, ForeignSnap>;
  fsell: Record<string, ForeignSnap>;
  /** Kunci "FROM_TO" (YYYY-MM-DD_YYYY-MM-DD); satu hari = FROM sama dengan TO. */
  inst: Record<string, InstSnap>;
  /** Jejak institusi harian dari running trade (opsional). */
  trace?: Record<string, TraceDay>;
  /** Pola lot besar live harian (opsional). */
  live?: Record<string, LiveDay>;
}
/** Sumber institusi di REKAP: Broker Analysis (broker pilihan) atau jejak running trade. */
export type InstSrc = "ba" | "trace";
export type RangeMode = "latest" | "today" | "5d" | "custom";
export interface RangeSel {
  mode: RangeMode;
  from?: string;
  to?: string;
  instSrc?: InstSrc;
}
export interface Totals {
  foreignBuy: number;
  foreignSell: number;
  instBuy: number;
  instSell: number;
}
export interface CoverageRow {
  day: string;
  fb: boolean;
  fs: boolean;
  inst: boolean;
  trace: boolean;
}
export interface RekapReport {
  mode: RangeMode;
  from: string | null;
  to: string | null;
  label: string;
  rekap: Rekap;
  fb: ForeignSnap | null;
  fs: ForeignSnap | null;
  inst: InstSnap | null;
  instSource: string;
  totals: Totals;
  coverage: CoverageRow[];
  /** DETEKSI INSTITUSI BELI dari pola lot besar live. */
  liveInst: LiveInstRow[];
  /** Pola beli lot besar pada emiten tanpa widget orderbook (asing tak terukur, kategori "?"). */
  liveUnknown: LiveInstRow[];
  liveDays: number;
  liveDayCount: number;
  /** DAFTAR TOTAL INSTITUSI: semua emiten net beli / net jual institusi, diurutkan nilai (gabungan semua kelompok). */
  instRank: InstRank;
}

export interface InstRankRow {
  rank: number;
  code: string;
  /** Net institusi (positif = beli, negatif = jual), Rupiah. */
  inst: number;
  /** Porsi terhadap total net beli (atau total net jual) institusi, 0..1. */
  share: number;
  avg: number | null;
  foreign: number | null;
  price: number | null;
  chgPct: number | null;
  /** Jumlah hari bursa emiten ini net beli (daftar beli) / net jual (daftar jual); null bila tidak dapat dihitung harian. */
  days: number | null;
}
export interface InstRank {
  buy: InstRankRow[];
  sell: InstRankRow[];
  /** Jumlah hari dengan data institusi harian dalam pilihan; null = sumber bukan harian (pengambilan terakhir / rentang langsung). */
  dataDays: number | null;
}

/** Hitung hari net beli / net jual per emiten dari data institusi harian (Broker Analysis harian atau jejak running trade). */
function instDayCounts(h: RekapHistory, days: string[], src: InstSrc): { buy: Map<string, number>; sell: Map<string, number>; dataDays: number } {
  const buy = new Map<string, number>();
  const sell = new Map<string, number>();
  const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  let dataDays = 0;
  for (const d of days) {
    if (src === "trace") {
      const t = h.trace?.[d];
      if (!t) continue;
      dataDays++;
      const net = new Map<string, number>();
      for (const n of t.nets) net.set(n.code, (net.get(n.code) ?? 0) + n.buy - n.sell);
      for (const [code, v] of net) if (v > 0) inc(buy, code); else if (v < 0) inc(sell, code);
    } else {
      const s = h.inst[`${d}_${d}`];
      if (!s) continue;
      dataDays++;
      for (const r of s.buys) inc(buy, r.code);
      for (const r of s.sells) inc(sell, r.code);
    }
  }
  return { buy, sell, dataDays };
}

/** Daftar total institusi dari semua kelompok REKAP. counts = null bila sumber bukan data harian. */
export function instRankOf(rekap: Rekap, totals: Totals, counts: ReturnType<typeof instDayCounts> | null): InstRank {
  const all = [...rekap.bothBuy, ...rekap.bothSell, ...rekap.divergent, ...rekap.instOnlyBuy, ...rekap.instOnlySell];
  const mk = (positive: boolean): InstRankRow[] =>
    all
      .filter((r) => r.inst !== null && (positive ? r.inst > 0 : r.inst < 0))
      .sort((a, b) => Math.abs(b.inst!) - Math.abs(a.inst!))
      .map((r, k) => {
        const tot = positive ? totals.instBuy : totals.instSell;
        return {
          rank: k + 1, code: r.code, inst: r.inst!, share: tot ? Math.abs(r.inst!) / tot : 0, avg: r.instAvg,
          foreign: r.foreign, price: r.price, chgPct: r.chgPct,
          days: counts ? ((positive ? counts.buy : counts.sell).get(r.code) ?? 0) : null,
        };
      });
  return { buy: mk(true), sell: mk(false), dataDays: counts ? counts.dataDays : null };
}

const DAY = 86400e3;
const toUtc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10);
const isWeekday = (d: string) => {
  const w = new Date(toUtc(d)).getUTCDay();
  return w >= 1 && w <= 5;
};

/** Hari kerja (Senin–Jumat) dari..sampai, inklusif. Hari libur bursa tidak diketahui. */
export function tradingDaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return out;
  for (let t = toUtc(from); t <= toUtc(to) && out.length < 400; t += DAY) {
    const d = fromUtc(t);
    if (isWeekday(d)) out.push(d);
  }
  return out;
}

/** Geser n hari kerja (n negatif = mundur). */
export function shiftTradingDays(day: string, n: number): string {
  let t = toUtc(day);
  let left = Math.abs(n);
  while (left > 0) {
    t += n < 0 ? -DAY : DAY;
    if (isWeekday(fromUtc(t))) left--;
  }
  return fromUtc(t);
}

export const fmtDay = (d: string | null) => {
  if (!d) return "?";
  const m = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"][Number(d.slice(5, 7)) - 1];
  return `${Number(d.slice(8, 10))} ${m} ${d.slice(0, 4)}`;
};

/** Rentang tanggal dari pilihan; today = hari bursa terakhir. */
export function resolveRange(sel: RangeSel, today: string): { from: string; to: string } | null {
  if (sel.mode === "today") return { from: today, to: today };
  if (sel.mode === "5d") return { from: shiftTradingDays(today, -5), to: today };
  if (sel.mode === "custom") {
    // Tanggal yang belum diisi: bawaan = 5 hari bursa sebelum s.d. hari bursa terakhir.
    const from = sel.from ?? shiftTradingDays(today, -5);
    const to = sel.to ?? today;
    return from <= to ? { from, to } : { from: to, to: from };
  }
  return null;
}

function sumForeign(h: RekapHistory, days: string[]): { buy: ForeignSnap | null; sell: ForeignSnap | null; label: string } {
  const net = new Map<string, number>();
  const value = new Map<string, number>();
  const first = new Map<string, { price: number | null; chgPct: number | null }>();
  const last = new Map<string, { price: number | null }>();
  let used = 0;
  let lastCap = 0;
  for (const d of days) {
    const parts: [ForeignSnap | undefined, 1 | -1][] = [[h.fbuy[d], 1], [h.fsell[d], -1]];
    if (!parts.some(([s]) => s)) continue;
    used++;
    for (const [s, sign] of parts) {
      if (!s) continue;
      lastCap = Math.max(lastCap, s.capturedAt);
      for (const r of s.rows) {
        net.set(r.code, (net.get(r.code) ?? 0) + sign * r.amount);
        value.set(r.code, (value.get(r.code) ?? 0) + (r.value ?? 0));
        if (!first.has(r.code)) first.set(r.code, { price: r.price, chgPct: r.chgPct });
        last.set(r.code, { price: r.price });
      }
    }
  }
  if (!used) return { buy: null, sell: null, label: "" };
  const rows = (positive: boolean): ForeignRow[] =>
    [...net.entries()]
      .filter(([, v]) => (positive ? v > 0 : v < 0))
      .map(([code, v]) => {
        const f = first.get(code)!;
        const l = last.get(code)!;
        // Perubahan harga sepanjang rentang: harga akhir vs penutupan sebelum hari pertama emiten tercatat.
        const prevClose = f.price !== null && f.chgPct !== null ? f.price / (1 + f.chgPct / 100) : null;
        const chg = prevClose && l.price !== null ? Math.round(((l.price / prevClose - 1) * 100) * 100) / 100 : null;
        return { code, amount: Math.abs(v), value: value.get(code) ?? null, price: l.price, chgPct: days.length === 1 ? f.chgPct : chg };
      })
      .sort((a, b) => b.amount - a.amount);
  const tag = days.length === 1 ? days[0]! : `${days[0]}..${days[days.length - 1]}`;
  return {
    buy: { kind: "buy", capturedAt: lastCap, day: tag, rows: rows(true) },
    sell: { kind: "sell", capturedAt: lastCap, day: tag, rows: rows(false) },
    label: `${used}/${days.length} hari bursa tersimpan`,
  };
}

function sumInst(h: RekapHistory, from: string, to: string, days: string[]): { inst: InstSnap | null; source: string } {
  const exact = h.inst[`${from}_${to}`];
  if (exact) return { inst: exact, source: `rentang ${exact.dateText ?? `${from}..${to}`} langsung dari Broker Analysis (dihitung Stockbit)` };
  const daily = days.map((d) => h.inst[`${d}_${d}`]).filter((x): x is InstSnap => !!x);
  if (!daily.length) return { inst: null, source: "" };
  const acc = new Map<string, { net: number; wv: number; w: number }>();
  for (const s of daily) {
    for (const [rows, sign] of [[s.buys, 1], [s.sells, -1]] as [InstRow[], number][]) {
      for (const r of rows) {
        const a = acc.get(r.code) ?? { net: 0, wv: 0, w: 0 };
        a.net += sign * r.value;
        if (r.avg !== null) {
          a.wv += r.avg * r.value;
          a.w += r.value;
        }
        acc.set(r.code, a);
      }
    }
  }
  const mk = (positive: boolean): InstRow[] =>
    [...acc.entries()]
      .filter(([, a]) => (positive ? a.net > 0 : a.net < 0))
      .map(([code, a]) => ({ code, value: Math.abs(a.net), lot: null, freq: null, avg: a.w ? Math.round(a.wv / a.w) : null }))
      .sort((x, y) => y.value - x.value);
  const brokerSets = new Set(daily.map((s) => s.brokers.map((b) => b.code).sort().join(",")));
  const last = daily[daily.length - 1]!;
  return {
    inst: {
      capturedAt: Math.max(...daily.map((s) => s.capturedAt)), day: to, dateText: `${from}..${to}`,
      brokers: last.brokers, metric: last.metric, investor: last.investor, board: last.board,
      buys: mk(true), sells: mk(false), bothSides: [],
    },
    source: `jumlah ${daily.length}/${days.length} hari tersimpan${brokerSets.size > 1 ? " • PERHATIAN: pilihan broker berbeda antar hari" : ""}`,
  };
}

/** Jumlah jejak institusi harian (running trade) -> InstSnap: net per emiten = Σ semua broker (beli − jual). */
function sumTrace(h: RekapHistory, days: string[]): { inst: InstSnap | null; source: string } {
  const tr = h.trace ?? {};
  const used = days.map((d) => tr[d]).filter((x): x is TraceDay => !!x);
  if (!used.length) return { inst: null, source: "" };
  const acc = new Map<string, { net: number; bPx: number; bLot: number; sPx: number; sLot: number }>();
  const brokerVal = new Map<string, number>();
  for (const d of used) {
    for (const n of d.nets) {
      const a = acc.get(n.code) ?? { net: 0, bPx: 0, bLot: 0, sPx: 0, sLot: 0 };
      a.net += n.buy - n.sell;
      if (n.buyAvg !== null) {
        a.bPx += n.buyAvg * n.buyLot;
        a.bLot += n.buyLot;
      }
      if (n.sellAvg !== null) {
        a.sPx += n.sellAvg * n.sellLot;
        a.sLot += n.sellLot;
      }
      acc.set(n.code, a);
      brokerVal.set(n.broker, (brokerVal.get(n.broker) ?? 0) + n.buy + n.sell);
    }
  }
  const mk = (positive: boolean): InstRow[] =>
    [...acc.entries()]
      .filter(([, a]) => (positive ? a.net > 0 : a.net < 0))
      .map(([code, a]) => ({
        code, value: Math.abs(a.net), lot: null, freq: null,
        avg: positive ? (a.bLot ? Math.round(a.bPx / a.bLot) : null) : a.sLot ? Math.round(a.sPx / a.sLot) : null,
      }))
      .sort((x, y) => y.value - x.value);
  const brokers = [...brokerVal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([code]) => ({ code, type: null }));
  const last = used[used.length - 1]!;
  return {
    inst: {
      capturedAt: last.savedAt, day: last.day, dateText: used.length === 1 ? last.day : `${used[0]!.day}..${last.day}`,
      brokers, metric: "Jejak running trade", investor: null, board: "RG", buys: mk(true), sells: mk(false), bothSides: [],
    },
    source: `jejak running trade ${used.length}/${days.length} hari (broker non-ritel, rangkaian besar)`,
  };
}

/** Kelengkapan data REKAP satu hari bursa. */
export function completeness(h: RekapHistory, day: string): { fb: boolean; fs: boolean; inst: boolean; trace: boolean; missing: string[] } {
  const c = { fb: !!h.fbuy[day], fs: !!h.fsell[day], inst: !!h.inst[`${day}_${day}`], trace: !!h.trace?.[day] };
  const missing: string[] = [];
  if (!c.fb) missing.push("asing beli");
  if (!c.fs) missing.push("asing jual");
  if (!c.inst && !c.trace) missing.push("institusi");
  return { ...c, missing };
}

export function totalsOf(r: Rekap): Totals {
  const all = [...r.bothBuy, ...r.bothSell, ...r.divergent, ...r.foreignOnlyBuy, ...r.foreignOnlySell, ...r.instOnlyBuy, ...r.instOnlySell];
  const t: Totals = { foreignBuy: 0, foreignSell: 0, instBuy: 0, instSell: 0 };
  for (const x of all) {
    if (x.foreign !== null) x.foreign > 0 ? (t.foreignBuy += x.foreign) : (t.foreignSell -= x.foreign);
    if (x.inst !== null) x.inst > 0 ? (t.instBuy += x.inst) : (t.instSell -= x.inst);
  }
  return t;
}

/** Susun laporan untuk pilihan rentang. mode "latest" = pengambilan terakhir (perilaku lama). */
export function makeReport(latest: { fb: ForeignSnap | null; fs: ForeignSnap | null; inst: InstSnap | null }, h: RekapHistory, sel: RangeSel, today: string): RekapReport {
  const range = resolveRange(sel, today);
  if (!range) {
    const tr = sel.instSrc === "trace" ? sumTrace(h, [today]) : null;
    const inst = tr ? tr.inst : latest.inst;
    const rekap = buildRekap(latest.fb, latest.fs, inst);
    if (tr) rekap.warnings = rekap.warnings.filter((w) => !/^Tanggal institusi/.test(w));
    const totals = totalsOf(rekap);
    return {
      mode: "latest", from: null, to: null, label: "Pengambilan terakhir", rekap, fb: latest.fb, fs: latest.fs, inst,
      instSource: tr ? tr.source : latest.inst ? `Broker Analysis ${latest.inst.dateText ?? ""}` : "", totals, coverage: [],
      ...liveFields(h, [today], rekap),
      instRank: instRankOf(rekap, totals, null),
    };
  }
  const days = tradingDaysBetween(range.from, range.to);
  const f = sumForeign(h, days);
  const i = sel.instSrc === "trace" ? sumTrace(h, days) : sumInst(h, range.from, range.to, days);
  const rekap = buildRekap(f.buy, f.sell, i.inst);
  // Peringatan tanggal dari buildRekap tidak relevan untuk rentang (semua sudah disamakan).
  rekap.warnings = rekap.warnings.filter((w) => !/^Tanggal /.test(w));
  const coverage = days.map((d) => ({ day: d, fb: !!h.fbuy[d], fs: !!h.fsell[d], inst: !!h.inst[`${d}_${d}`], trace: !!h.trace?.[d] }));
  if (f.buy && coverage.some((c) => !c.fb && !c.fs)) rekap.warnings.unshift(`Asing: ${f.label}; hari yang kosong dihitung 0 (ESTIMASI).`);
  const totals = totalsOf(rekap);
  const src: InstSrc = sel.instSrc === "trace" ? "trace" : "ba";
  // Rentang langsung dari Broker Analysis (dihitung Stockbit) tidak punya rincian harian.
  const exact = src === "ba" && !!h.inst[`${range.from}_${range.to}`] && range.from !== range.to;
  return {
    mode: sel.mode, from: range.from, to: range.to,
    label: range.from === range.to ? fmtDay(range.from) : `${fmtDay(range.from)} – ${fmtDay(range.to)}`,
    rekap, fb: f.buy, fs: f.sell, inst: i.inst, instSource: i.source, totals, coverage,
    ...liveFields(h, days, rekap),
    instRank: instRankOf(rekap, totals, exact ? null : instDayCounts(h, days, src)),
  };
}

function liveFields(h: RekapHistory, days: string[], rekap: Rekap): Pick<RekapReport, "liveInst" | "liveUnknown" | "liveDays" | "liveDayCount"> {
  const l = liveInstRows(h, days, rekap);
  return { liveInst: l.rows, liveUnknown: l.unknown, liveDays: l.daysWithData, liveDayCount: days.length };
}

/** Kunci riwayat di chrome.storage.local. */
export const HIST_PREFIX = "rbRekapH:";
export function histKey(kind: "fbuy" | "fsell", day: string): string;
export function histKey(kind: "inst", from: string, to: string): string;
export function histKey(kind: "fbuy" | "fsell" | "inst", a: string, b?: string): string {
  return kind === "inst" ? `${HIST_PREFIX}inst:${a}_${b}` : `${HIST_PREFIX}${kind}:${a}`;
}
/** Jejak institusi harian dari running trade. */
export const TRACE_PREFIX = "rbInstH:";

/** Masukkan satu entri storage ke riwayat; kembalikan true bila kunci dikenali. */
export function putHistory(h: RekapHistory, key: string, v: unknown): boolean {
  if (key.startsWith(LIVE_PREFIX)) {
    const day = key.slice(LIVE_PREFIX.length);
    h.live ??= {};
    if (v) h.live[day] = v as LiveDay;
    else delete h.live[day];
    return true;
  }
  if (key.startsWith(TRACE_PREFIX)) {
    const day = key.slice(TRACE_PREFIX.length);
    h.trace ??= {};
    if (v) h.trace[day] = v as TraceDay;
    else delete h.trace[day];
    return true;
  }
  if (!key.startsWith(HIST_PREFIX)) return false;
  const [kind, id] = key.slice(HIST_PREFIX.length).split(":") as [string, string];
  const bucket = kind === "fbuy" ? h.fbuy : kind === "fsell" ? h.fsell : kind === "inst" ? h.inst : null;
  if (!bucket || !id) return false;
  if (v) bucket[id] = v as never;
  else delete bucket[id];
  return true;
}

/** Ringkasan POLA LOT BESAR LIVE harian (dari running trade saat sesi), disimpan "rbLiveH:YYYY-MM-DD". */
export interface LiveDay {
  day: string;
  savedAt: number;
  rows: LiveSumRow[];
  /** Rekaman rangkaian (untuk digabung bila halaman dimuat ulang di hari yang sama). */
  recs?: LiveRec[];
}
export const LIVE_PREFIX = "rbLiveH:";

/** Baris DETEKSI INSTITUSI BELI: akumulasi pola INSTITUSI/LOKAL per emiten + pembanding Broker Analysis. */
export interface LiveInstRow {
  code: string;
  instBuy: number;
  instSell: number;
  net: number;
  instRuns: number;
  asingBuy: number;
  asingSell: number;
  /** Pola tanpa kategori ("?": emiten tanpa widget orderbook, asing tak terukur). */
  unkBuy: number;
  unkSell: number;
  /** Jumlah hari (dalam pilihan) yang emiten ini punya pola. */
  days: number;
  /** Net institusi dari Broker Analysis (REKAP) untuk emiten yang sama; null bila tidak ada di daftar. */
  ba: number | null;
}

export function liveInstRows(h: RekapHistory, days: string[], rekap: Rekap): { rows: LiveInstRow[]; unknown: LiveInstRow[]; daysWithData: number } {
  const acc = new Map<string, LiveInstRow>();
  let daysWithData = 0;
  for (const d of days) {
    const ld = h.live?.[d];
    if (!ld) continue;
    daysWithData++;
    for (const r of ld.rows) {
      const a = acc.get(r.code) ?? { code: r.code, instBuy: 0, instSell: 0, net: 0, instRuns: 0, asingBuy: 0, asingSell: 0, unkBuy: 0, unkSell: 0, days: 0, ba: null };
      a.instBuy += r.instBuy;
      a.instSell += r.instSell;
      a.instRuns += r.instRuns;
      a.asingBuy += r.asingBuy;
      a.asingSell += r.asingSell;
      a.unkBuy += Math.max(0, r.buy - r.asingBuy - r.instBuy);
      a.unkSell += Math.max(0, r.sell - r.asingSell - r.instSell);
      if (r.instBuy || r.instSell) a.days++;
      acc.set(r.code, a);
    }
  }
  const all = [...rekap.bothBuy, ...rekap.bothSell, ...rekap.divergent, ...rekap.instOnlyBuy, ...rekap.instOnlySell];
  const ba = new Map(all.filter((x) => x.inst !== null).map((x) => [x.code, x.inst!]));
  const all2 = [...acc.values()].map((a) => ({ ...a, net: a.instBuy - a.instSell, ba: ba.get(a.code) ?? null }));
  const rows = all2.filter((a) => a.instBuy > 0 && a.net > 0).sort((x, y) => y.net - x.net);
  const unknown = all2.filter((a) => a.unkBuy - a.unkSell > 0).sort((x, y) => y.unkBuy - y.unkSell - (x.unkBuy - x.unkSell));
  return { rows, unknown, daysWithData };
}

/** Blok CSV DAFTAR TOTAL INSTITUSI NET BELI / NET JUAL. */
export function instRankCSV(rep: Pick<RekapReport, "instRank" | "label">): string {
  const k = rep.instRank;
  const head = [
    `# DAFTAR TOTAL INSTITUSI (${rep.label.replace(/\n/g, " ")}; ESTIMASI)${k.dataDays !== null ? `; data harian ${k.dataDays} hari` : ""}`,
    "sisi,peringkat,kode,inst_net,porsi_pct,avg_inst,hari_searah,asing_net,harga,chg_pct",
  ];
  const line = (side: string, r: InstRankRow) =>
    [side, r.rank, r.code, r.inst, Math.round(r.share * 10000) / 100, r.avg ?? "", r.days ?? "", r.foreign ?? "", r.price ?? "", r.chgPct ?? ""].join(",");
  return [...head, ...k.buy.map((r) => line("net beli", r)), ...k.sell.map((r) => line("net jual", r))].join("\n") + "\n";
}

/** Blok CSV tambahan untuk DETEKSI INSTITUSI BELI (ditempel di bawah CSV REKAP). */
export function liveInstCSV(rep: Pick<RekapReport, "liveInst" | "liveUnknown" | "liveDays" | "liveDayCount">): string {
  const head = [
    `# DETEKSI INSTITUSI BELI (pola lot besar live; ESTIMASI; data pola ${rep.liveDays}/${rep.liveDayCount} hari bursa)`,
    "kelompok,kode,inst_beli,inst_jual,inst_net,rangkaian_inst,hari,asing_beli_pola,asing_jual_pola,tanpa_kategori_beli,tanpa_kategori_jual,broker_analysis_inst_net",
  ];
  const line = (g: string, r: LiveInstRow) =>
    [g, r.code, r.instBuy, r.instSell, r.net, r.instRuns, r.days, r.asingBuy, r.asingSell, r.unkBuy, r.unkSell, r.ba ?? ""].join(",");
  return [...head, ...rep.liveInst.map((r) => line("inst beli pola", r)), ...rep.liveUnknown.map((r) => line("beli lot besar ? (tanpa widget)", r))].join("\n") + "\n";
}
