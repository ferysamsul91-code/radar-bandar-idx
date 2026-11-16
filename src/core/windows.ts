import type { Side } from "./types";

interface Entry {
  ts: number;
  buy: number;
  sell: number;
  unknown: number;
  bigBuy: number;
  bigSell: number;
  tc: number; // jumlah trade (0 untuk entri big)
}

export interface WindowMetrics {
  buyValue: number;
  sellValue: number;
  unknownValue: number;
  /** valueBUY / (valueBUY + valueSELL); null jika belum ada trade bersisi. */
  buyPct: number | null;
  aggrFlow: number;
  bigBuy: number;
  bigSell: number;
  bigNet: number;
  /** (bigBuy + bigSell) / total value; null jika total 0. */
  bigShare: number | null;
  trades: number;
}

/**
 * Rolling window berbasis waktu. Entri dengan ts <= now - duration dikeluarkan.
 * durationMs = Infinity untuk window sesi (reset manual).
 */
export class RollingWindow {
  private q: Entry[] = [];
  private head = 0;
  private s = { buy: 0, sell: 0, unknown: 0, bigBuy: 0, bigSell: 0, trades: 0 };

  constructor(readonly durationMs: number) {}

  addTrade(ts: number, side: Side, value: number): void {
    const e: Entry = { ts, buy: 0, sell: 0, unknown: 0, bigBuy: 0, bigSell: 0, tc: 1 };
    if (side === "BUY") e.buy = value;
    else if (side === "SELL") e.sell = value;
    else e.unknown = value;
    this.push(e);
  }

  /** Tambah nilai lot besar (dari trade tunggal atau cluster yang melewati ambang). */
  addBig(ts: number, side: Side, value: number): void {
    if (side === "UNKNOWN") return;
    this.push({ ts, buy: 0, sell: 0, unknown: 0, bigBuy: side === "BUY" ? value : 0, bigSell: side === "SELL" ? value : 0, tc: 0 });
  }

  private push(e: Entry): void {
    this.q.push(e);
    this.s.buy += e.buy;
    this.s.sell += e.sell;
    this.s.unknown += e.unknown;
    this.s.bigBuy += e.bigBuy;
    this.s.bigSell += e.bigSell;
    this.s.trades += e.tc;
  }

  evict(now: number): void {
    if (!Number.isFinite(this.durationMs)) return;
    const cutoff = now - this.durationMs;
    while (this.head < this.q.length && this.q[this.head]!.ts <= cutoff) {
      const e = this.q[this.head]!;
      this.s.buy -= e.buy;
      this.s.sell -= e.sell;
      this.s.unknown -= e.unknown;
      this.s.bigBuy -= e.bigBuy;
      this.s.bigSell -= e.bigSell;
      this.s.trades -= e.tc;
      this.head++;
    }
    // Pemadatan berkala agar array tidak tumbuh tanpa batas.
    if (this.head > 1024 && this.head * 2 > this.q.length) {
      this.q = this.q.slice(this.head);
      this.head = 0;
    }
  }

  reset(): void {
    this.q = [];
    this.head = 0;
    this.s = { buy: 0, sell: 0, unknown: 0, bigBuy: 0, bigSell: 0, trades: 0 };
  }

  metrics(now?: number): WindowMetrics {
    if (now !== undefined) this.evict(now);
    // Bulatkan sisa floating-point dari pengurangan berulang.
    const r = (x: number) => (Math.abs(x) < 1e-6 ? 0 : x);
    const buy = r(this.s.buy);
    const sell = r(this.s.sell);
    const unknown = r(this.s.unknown);
    const bigBuy = r(this.s.bigBuy);
    const bigSell = r(this.s.bigSell);
    const total = buy + sell + unknown;
    return {
      buyValue: buy,
      sellValue: sell,
      unknownValue: unknown,
      buyPct: buy + sell > 0 ? buy / (buy + sell) : null,
      aggrFlow: buy - sell,
      bigBuy,
      bigSell,
      bigNet: bigBuy - bigSell,
      bigShare: total > 0 ? (bigBuy + bigSell) / total : null,
      trades: this.s.trades,
    };
  }
}

/** Kumpulan window per emiten: label -> RollingWindow (+ "sesi"). */
export class WindowSet {
  readonly windows = new Map<string, RollingWindow>();

  constructor(windowsSec: readonly number[]) {
    for (const sec of windowsSec) this.windows.set(labelFor(sec), new RollingWindow(sec * 1000));
    this.windows.set("sesi", new RollingWindow(Infinity));
  }

  addTrade(ts: number, side: Side, value: number): void {
    for (const w of this.windows.values()) w.addTrade(ts, side, value);
  }

  addBig(ts: number, side: Side, value: number): void {
    for (const w of this.windows.values()) w.addBig(ts, side, value);
  }

  metrics(now: number): Record<string, WindowMetrics> {
    const out: Record<string, WindowMetrics> = {};
    for (const [k, w] of this.windows) out[k] = w.metrics(now);
    return out;
  }

  resetSession(): void {
    for (const w of this.windows.values()) w.reset();
  }
}

export function labelFor(sec: number): string {
  if (sec % 3600 === 0) return `${sec / 3600}h`;
  if (sec % 60 === 0) return `${sec / 60}m`;
  return `${sec}s`;
}
