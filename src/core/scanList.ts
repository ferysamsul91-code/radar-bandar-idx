/**
 * Daftar Pindai semi-manual untuk DIVERGENCE: pengguna sendiri membuka tiap emiten di Chartbit (Table view);
 * radar hanya mencatat mana yang sudah terbaca untuk hari bursa terakhir.
 */
import type { ChartStore } from "./chartStore";
import { parseCodeList } from "./settings";

export const SCAN_KEY = "rbScanList";

export interface ScanProgress {
  done: string[];
  /** Belum ada data, atau datanya belum sampai hari bursa terakhir. */
  todo: { code: string; lastT: string | null }[];
  next: string | null;
}

/** Status pindai: emiten dianggap selesai bila candle terakhirnya >= hari bursa terakhir (timeframe apa pun). */
export function scanProgress(list: string[], charts: ChartStore[], tradingDay: string): ScanProgress {
  const last = new Map<string, string>();
  for (const c of charts) {
    const t = c.bars.at(-1)?.t.slice(0, 10);
    if (t && (!last.has(c.symbol) || t > last.get(c.symbol)!)) last.set(c.symbol, t);
  }
  const done: string[] = [];
  const todo: ScanProgress["todo"] = [];
  for (const code of list) {
    const t = last.get(code) ?? null;
    if (t && t >= tradingDay) done.push(code);
    else todo.push({ code, lastT: t });
  }
  return { done, todo, next: todo[0]?.code ?? null };
}

/** Teks bebas -> daftar kode unik (huruf besar). */
export const normalizeScanList = (s: string) => parseCodeList(s);

export const chartbitUrl = (code: string) => `https://stockbit.com/symbol/${encodeURIComponent(code)}/chartbit`;
