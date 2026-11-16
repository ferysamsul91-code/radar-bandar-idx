/**
 * Deteksi divergence harga vs osilator, gaya indikator "Divergences" TradingView:
 *  - pivot dicari di OSILATOR (lookback kiri L, kanan R); harga diambil di bar pivot itu (low untuk dasar, high untuk puncak);
 *  - dibandingkan dengan pivot sejenis SEBELUMNYA yang berjarak minRange..maxRange bar.
 *  BULLISH         : harga lower low,  osilator higher low
 *  HIDDEN BULLISH  : harga higher low, osilator lower low
 *  BEARISH         : harga higher high, osilator lower high
 *  HIDDEN BEARISH  : harga lower high, osilator higher high
 * Sinyal baru terkonfirmasi R bar setelah pivot (sama seperti TradingView). Parameter = ESTIMASI, bisa diubah di Settings.
 */
import type { ChartBar } from "../content/parse-chartbit";

export type DivType = "BULLISH" | "HIDDEN BULLISH" | "BEARISH" | "HIDDEN BEARISH";
export const DIV_TYPES: DivType[] = ["HIDDEN BULLISH", "BULLISH", "HIDDEN BEARISH", "BEARISH"];

export interface DivCfg {
  left: number;
  right: number;
  minRange: number;
  maxRange: number;
  /** Sinyal dianggap "baru" bila pivot kedua <= maxAgeBars bar dari candle terakhir. */
  maxAgeBars: number;
  /** "auto" | "RSI" | "Stoch RSI" | "MACD" | "rsi-calc" */
  oscillator: string;
}
export const DEFAULT_DIV: DivCfg = { left: 5, right: 5, minRange: 5, maxRange: 60, maxAgeBars: 15, oscillator: "RSI" };

export interface DivPoint {
  t: string;
  price: number;
  osc: number;
}
export interface DivSignal {
  type: DivType;
  p1: DivPoint;
  p2: DivPoint;
  /** Jarak candle terakhir ke pivot kedua. */
  barsAgo: number;
}

/** RSI Wilder dari harga penutupan (bar urut lama -> baru). null selama masa pemanasan. */
export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = closes.map(() => null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/** Pilih kolom osilator dari Table view. */
export function pickOscillator(keys: string[], pref = "auto"): { key: string | null; label: string } {
  const find = (re: RegExp, col?: RegExp) => keys.find((k) => re.test(k.split("|")[0]!) && (!col || col.test(k.split("|")[1] ?? "")));
  const byPref: Record<string, () => string | undefined> = {
    // Kolom garis RSI (bukan "RSI-based MA" / garis rata-rata).
    RSI: () =>
      find(/^RSI\b/i, /^RSI$/i) ??
      keys.find((k) => /^RSI\b/i.test(k.split("|")[0]!) && !/MA|based|smooth/i.test(k.split("|")[1] ?? "")) ??
      find(/^RSI\b/i),
    "Stoch RSI": () => find(/stoch\s*rsi/i, /%K/i) ?? find(/stoch\s*rsi/i),
    MACD: () => find(/^MACD/i, /^MACD$/i) ?? find(/^MACD/i, /hist/i) ?? find(/^MACD/i),
  };
  if (pref === "rsi-calc") return { key: null, label: "RSI 14 (dihitung radar)" };
  const order = pref === "auto" ? ["RSI", "Stoch RSI", "MACD"] : [pref];
  for (const p of order) {
    const k = byPref[p]?.();
    // Kolom tunggal TradingView bernama "Plot" (mis. RSI 14) -> cukup nama indikatornya.
    if (k) return { key: k, label: /\|(Plot)?$/i.test(k) ? k.split("|")[0]! : k.replace("|", " ") };
  }
  return { key: null, label: "RSI 14 (dihitung radar)" };
}

/** Indeks pivot pada deret; low=true untuk dasar. Kiri ketat, kanan tidak ketat (dataran rata dihitung sekali). */
function pivots(v: (number | null)[], L: number, R: number, low: boolean): number[] {
  const out: number[] = [];
  for (let i = L; i < v.length - R; i++) {
    const x = v[i];
    if (x == null) continue;
    let ok = true;
    for (let j = i - L; j <= i + R && ok; j++) {
      if (j === i) continue;
      const y = v[j];
      if (y == null) ok = false;
      else if (j < i) ok = low ? x < y : x > y;
      else ok = low ? x <= y : x >= y;
    }
    if (ok) out.push(i);
  }
  return out;
}

/** Semua divergence pada deret (bar urut lama -> baru). */
export function findDivergences(bars: ChartBar[], osc: (number | null)[], cfg: DivCfg): DivSignal[] {
  const out: DivSignal[] = [];
  const last = bars.length - 1;
  const pt = (i: number, price: number): DivPoint => ({ t: bars[i]!.t, price, osc: osc[i]! });
  const scan = (low: boolean) => {
    const ps = pivots(osc, cfg.left, cfg.right, low);
    for (let k = 1; k < ps.length; k++) {
      const a = ps[k - 1]!;
      const b = ps[k]!;
      const dist = b - a;
      if (dist < cfg.minRange || dist > cfg.maxRange) continue;
      const oa = osc[a]!;
      const ob = osc[b]!;
      if (low) {
        const pa = bars[a]!.l;
        const pb = bars[b]!.l;
        if (pb < pa && ob > oa) out.push({ type: "BULLISH", p1: pt(a, pa), p2: pt(b, pb), barsAgo: last - b });
        else if (pb > pa && ob < oa) out.push({ type: "HIDDEN BULLISH", p1: pt(a, pa), p2: pt(b, pb), barsAgo: last - b });
      } else {
        const pa = bars[a]!.h;
        const pb = bars[b]!.h;
        if (pb > pa && ob < oa) out.push({ type: "BEARISH", p1: pt(a, pa), p2: pt(b, pb), barsAgo: last - b });
        else if (pb < pa && ob > oa) out.push({ type: "HIDDEN BEARISH", p1: pt(a, pa), p2: pt(b, pb), barsAgo: last - b });
      }
    }
  };
  scan(true);
  scan(false);
  return out.sort((x, y) => x.barsAgo - y.barsAgo);
}

export interface SymbolDivergence {
  symbol: string;
  timeframe: string;
  bars: number;
  lastT: string | null;
  oscLabel: string;
  /** Sinyal terbaru per jenis (apa pun umurnya). */
  latest: Partial<Record<DivType, DivSignal>>;
}

/** Analisis satu emiten dari bar tersimpan (urutan bebas). */
export function analyzeSymbol(symbol: string, timeframe: string, barsIn: ChartBar[], cfg: DivCfg): SymbolDivergence {
  const bars = [...barsIn].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const keys = [...new Set(bars.flatMap((b) => Object.keys(b.ind)))];
  const pick = pickOscillator(keys, cfg.oscillator);
  const osc = pick.key ? bars.map((b) => b.ind[pick.key!] ?? null) : rsi(bars.map((b) => b.c));
  const latest: SymbolDivergence["latest"] = {};
  for (const s of findDivergences(bars, osc, cfg)) latest[s.type] ??= s;
  return { symbol, timeframe, bars: bars.length, lastT: bars.at(-1)?.t ?? null, oscLabel: pick.label, latest };
}
