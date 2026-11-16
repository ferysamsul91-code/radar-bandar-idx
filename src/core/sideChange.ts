/**
 * Pergantian sisi PADA BELI <-> PADA JUAL.
 * Terkonfirmasi jika kondisi baru bertahan >= confirmSec DAN ada >= minBigTrades trade lot besar
 * di sisi baru sejak kondisi itu mulai.
 */
export type FlowSide = "BELI" | "JUAL";

export interface SideChangeConfig {
  confirmSec: number;
  minBigTrades: number;
}

export interface SideChange {
  from: FlowSide;
  to: FlowSide;
  at: number;
}

export class SideChangeTracker {
  side: FlowSide | null = null;
  pending: { to: FlowSide; since: number; big: number } | null = null;
  history: SideChange[] = [];

  constructor(private cfg: SideChangeConfig) {}

  /** Catat trade lot besar (BUY -> BELI, SELL -> JUAL). */
  addBig(ts: number, side: "BUY" | "SELL"): void {
    const s: FlowSide = side === "BUY" ? "BELI" : "JUAL";
    if (this.pending && this.pending.to === s && ts >= this.pending.since) this.pending.big++;
  }

  /** candidate: sisi yang ditunjukkan status saat ini (null = netral). */
  update(now: number, candidate: FlowSide | null): void {
    if (candidate === null) {
      this.pending = null;
      return;
    }
    if (this.side === null) {
      this.side = candidate; // sisi awal, belum ada "pergantian"
      return;
    }
    if (candidate === this.side) {
      this.pending = null;
      return;
    }
    if (!this.pending || this.pending.to !== candidate) {
      this.pending = { to: candidate, since: now, big: 0 };
    }
    if (now - this.pending.since >= this.cfg.confirmSec * 1000 && this.pending.big >= this.cfg.minBigTrades) {
      this.history.push({ from: this.side, to: candidate, at: now });
      this.side = candidate;
      this.pending = null;
    }
  }

  get last(): SideChange | null {
    return this.history[this.history.length - 1] ?? null;
  }
}
