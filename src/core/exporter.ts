/** Export sesi ke CSV / JSONL (dibuat di browser, diunduh lokal; tidak dikirim ke mana pun). */
import type { Trade } from "./types";

const COLS = ["ts", "waktu_wib", "code", "price", "lot", "value", "side", "buyer", "buyer_type", "seller", "seller_type", "board", "hash"] as const;

const csvCell = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const wibIso = (ts: number) => new Date(ts + 7 * 3600e3).toISOString().replace("Z", "+07:00");

export function tradesToCSV(trades: readonly Trade[]): string {
  const rows = trades.map((t) =>
    [t.ts, wibIso(t.ts), t.code, t.price, t.lot, t.value, t.side, t.buyerBroker, t.buyerType, t.sellerBroker, t.sellerType, t.board, t.hash]
      .map(csvCell)
      .join(","),
  );
  return [COLS.join(","), ...rows].join("\n") + "\n";
}

export function tradesToJSONL(trades: readonly Trade[]): string {
  return trades.map((t) => JSON.stringify(t)).join("\n") + (trades.length ? "\n" : "");
}

/** Kebalikan JSONL (untuk replay di tahap 7). Baris rusak dilewati. */
export function parseJSONL(text: string): Trade[] {
  const out: Trade[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const t = JSON.parse(line) as Trade;
      if (typeof t.ts === "number" && typeof t.code === "string" && typeof t.price === "number") out.push(t);
    } catch { /* lewati */ }
  }
  return out;
}
