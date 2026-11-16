/** Penyimpanan candle Chartbit per emiten & timeframe ("rbChart:KODE:TF"), digabung per tanggal. */
import type { ChartBar } from "../content/parse-chartbit";

export const CHART_PREFIX = "rbChart:";
export const MAX_BARS = 400;

export interface ChartStore {
  symbol: string;
  tf: string;
  updatedAt: number;
  /** Urut lama -> baru. */
  bars: ChartBar[];
}

export const chartKey = (symbol: string, tf: string) => `${CHART_PREFIX}${symbol}:${tf}`;

/** Gabung bar baru ke simpanan (bar dengan tanggal sama diganti yang baru). Kembalikan null bila tidak ada perubahan. */
export function mergeBars(prev: ChartStore | undefined, symbol: string, tf: string, fresh: ChartBar[], now: number): ChartStore | null {
  const m = new Map<string, ChartBar>((prev?.bars ?? []).map((b) => [b.t, b]));
  let changed = !prev;
  for (const b of fresh) {
    const old = m.get(b.t);
    if (!old || JSON.stringify(old) !== JSON.stringify(b)) {
      m.set(b.t, b);
      changed = true;
    }
  }
  if (!changed) return null;
  const bars = [...m.values()].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)).slice(-MAX_BARS);
  return { symbol, tf, updatedAt: now, bars };
}
