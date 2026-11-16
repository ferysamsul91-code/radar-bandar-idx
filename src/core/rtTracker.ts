/**
 * Pelacak baris baru di daftar running trade (terbaru di atas, baris lama terbuang di bawah).
 *
 * Baris dengan isi identik bisa merupakan trade berbeda yang sah (mis. GOTO 33.690 lot berulang
 * pada detik yang sama), jadi dedup tidak boleh hanya memakai isi baris. Caranya:
 *  1. Cari posisi k terkecil sehingga daftar baru [k..] sama persis dengan awal daftar lama.
 *     Baris [0..k) adalah trade baru.
 *  2. Tiap trade baru diberi urutan kemunculan per isi (seq) -> hash unik code|...|seq.
 * Jika tidak ada tumpang-tindih sama sekali (mis. filter emiten diganti), semua baris dianggap
 * baru dan `resyncs` bertambah.
 */
export interface Keyed {
  key: string;
}

export class RunningTradeTracker<T extends Keyed> {
  private prev: string[] = [];
  private seq = new Map<string, number>();
  resyncs = 0;

  /** rows: urutan layar (terbaru di atas). Mengembalikan trade baru, urut lama -> baru, dengan seq. */
  ingest(rows: readonly T[]): (T & { seq: number; hash: string })[] {
    const keys = rows.map((r) => r.key);
    // Panel tertutup/kosong: simpan daftar lama supaya saat dibuka lagi tidak dihitung ulang.
    if (keys.length === 0) return [];
    const k = this.prev.length === 0 ? keys.length : this.findOverlap(keys);
    if (this.prev.length > 0 && k === keys.length && keys.length > 0) this.resyncs++;
    this.prev = keys;

    const out: (T & { seq: number; hash: string })[] = [];
    for (let i = k - 1; i >= 0; i--) {
      const r = rows[i]!;
      const n = this.seq.get(r.key) ?? 0;
      this.seq.set(r.key, n + 1);
      out.push({ ...r, seq: n, hash: `${r.key}|${n}` });
    }
    return out;
  }

  /** k terkecil dengan keys[k..] == prev[0..len-k]; keys.length jika tidak ada. */
  private findOverlap(keys: string[]): number {
    for (let k = 0; k < keys.length; k++) {
      const m = Math.min(keys.length - k, this.prev.length);
      let ok = m > 0;
      for (let j = 0; ok && j < m; j++) if (keys[k + j] !== this.prev[j]) ok = false;
      if (ok) return k;
    }
    return keys.length;
  }

  reset(): void {
    this.prev = [];
    this.seq.clear();
    this.resyncs = 0;
  }
}
