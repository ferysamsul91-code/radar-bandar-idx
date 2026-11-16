export interface HashInput {
  code: string;
  time: string | number; // jam dari layar ("10:08:17") atau epoch
  price: number;
  lot: number;
  buyer?: string;
  seller?: string;
  /** Urutan kemunculan baris identik pada detik yang sama (dari parser). */
  seq: number;
}

/** hash = code|time|price|lot|buyer|seller|urutan */
export function tradeHash(t: HashInput): string {
  return [t.code, t.time, t.price, t.lot, t.buyer ?? "", t.seller ?? "", t.seq].join("|");
}

/**
 * Penyaring duplikat dari re-render DOM. Menyimpan maksimal `capacity` hash terakhir
 * (yang tertua dibuang) agar memori tetap kecil sepanjang sesi.
 */
export class Deduper {
  private seen = new Set<string>();
  dupCount = 0;

  constructor(private capacity = 50_000) {}

  /** true = trade baru (lanjut diproses); false = duplikat (DUP bertambah). */
  accept(hash: string): boolean {
    if (this.seen.has(hash)) {
      this.dupCount++;
      return false;
    }
    this.seen.add(hash);
    if (this.seen.size > this.capacity) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }

  reset(): void {
    this.seen.clear();
    this.dupCount = 0;
  }
}
