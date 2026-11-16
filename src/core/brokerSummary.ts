/**
 * Ringkasan Broker Summary per emiten.
 * Net per kategori = Σ nilai beli − Σ nilai jual broker kategori itu (berlaku untuk mode Net maupun Gross).
 * Kategori = kepemilikan broker menurut Stockbit (foreign / local / bumn), bukan kebangsaan investor.
 * Label AKUMULASI/DISTRIBUSI di sini hitungan radar sendiri (ESTIMASI), bukan "Broker Action" Stockbit.
 */
import type { BrokerOwner, BrokerSummaryParse, BsSide } from "../content/parse-broker-summary";

export interface BsConfig {
  topN: number;
  accDistThreshold: number;
}

export interface BsSummary {
  code: string;
  dateText: string | null;
  investor: string | null;
  board: string | null;
  mode: string | null;
  capturedAt: number;
  rows: number;
  totalBuy: number;
  totalSell: number;
  net: Record<BrokerOwner | "unknown", number>;
  topBuyers: Pick<BsSide, "broker" | "owner" | "value" | "avg">[];
  topSellers: Pick<BsSide, "broker" | "owner" | "value" | "avg">[];
  /** (ΣtopN beli − ΣtopN jual) / (ΣtopN beli + ΣtopN jual), −1..+1. */
  accDist: number | null;
  accDistLabel: "AKUMULASI" | "DISTRIBUSI" | "NETRAL" | null;
  /** Kode broker -> kategori Stockbit, untuk melengkapi peta broker. */
  owners: Record<string, BrokerOwner>;
}

const sum = (xs: BsSide[]) => xs.reduce((a, x) => a + x.value, 0);
const pick = ({ broker, owner, value, avg }: BsSide) => ({ broker, owner, value, avg });

export function summarizeBrokerSummary(code: string, p: BrokerSummaryParse, now: number, cfg: BsConfig): BsSummary {
  const net: BsSummary["net"] = { foreign: 0, local: 0, bumn: 0, unknown: 0 };
  const owners: Record<string, BrokerOwner> = {};
  for (const b of p.buyers) net[b.owner ?? "unknown"] += b.value;
  for (const s of p.sellers) net[s.owner ?? "unknown"] -= s.value;
  for (const x of [...p.buyers, ...p.sellers]) if (x.owner) owners[x.broker] = x.owner;
  const byVal = (a: BsSide, b: BsSide) => b.value - a.value;
  const tb = [...p.buyers].sort(byVal).slice(0, cfg.topN);
  const ts = [...p.sellers].sort(byVal).slice(0, cfg.topN);
  const B = sum(tb);
  const S = sum(ts);
  const accDist = B + S > 0 ? (B - S) / (B + S) : null;
  const accDistLabel = accDist === null ? null : accDist >= cfg.accDistThreshold ? "AKUMULASI" : accDist <= -cfg.accDistThreshold ? "DISTRIBUSI" : "NETRAL";
  return {
    code, dateText: p.dateText, investor: p.investor, board: p.board, mode: p.mode, capturedAt: now,
    rows: p.rowsOk, totalBuy: sum(p.buyers), totalSell: sum(p.sellers), net,
    topBuyers: tb.slice(0, 3).map(pick), topSellers: ts.slice(0, 3).map(pick),
    accDist, accDistLabel, owners,
  };
}

/** Sama isinya (abaikan capturedAt) -> tidak perlu ditulis ulang ke storage. */
export function sameSummary(a: BsSummary | undefined, b: BsSummary): boolean {
  if (!a) return false;
  return JSON.stringify({ ...a, capturedAt: 0 }) === JSON.stringify({ ...b, capturedAt: 0 });
}
