export type Side = "BUY" | "SELL" | "UNKNOWN";
export type Board = "RG" | "NG" | "TN";
export type InvestorType = "D" | "F";

export interface Trade {
  ts: number; // epoch ms
  code: string; // "BBRI"
  price: number;
  lot: number; // 1 lot = 100 lembar
  value: number; // price * lot * 100 (Rupiah)
  side: Side; // sisi agresor
  buyerBroker?: string;
  sellerBroker?: string;
  buyerType?: InvestorType;
  sellerType?: InvestorType;
  board: Board;
  hash: string;
}

export interface BookLevel {
  price: number;
  lot: number;
  freq: number;
}

export interface BookSnapshot {
  ts: number;
  code: string;
  bids: BookLevel[]; // urut harga turun (bids[0] = best bid)
  offers: BookLevel[]; // urut harga naik (offers[0] = best offer)
  /** Statistik dari layar; null jika tidak tampil/gagal di-parse. */
  prev: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  ara: number | null;
  arb: number | null;
  avg: number | null;
  totalLot: number | null;
  totalValue: number | null;
  /** "F Buy" / "F Sell" di widget orderbook Stockbit (Rupiah, akumulasi hari ini). */
  foreignBuy?: number | null;
  foreignSell?: number | null;
  freq?: number | null;
  last?: number | null;
  /** Total antrean dari footer widget (seluruh level, bukan hanya yang tampil). */
  totals?: { bidFreq: number; bidLot: number; offerLot: number; offerFreq: number } | null;
}

export type SizeCategory = "BESAR" | "SEDANG" | "RITEL";
