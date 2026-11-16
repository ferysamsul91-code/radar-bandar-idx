/**
 * Fraksi harga (tick) saham BEI papan reguler.
 * ESTIMASI: tabel umum BEI; cek ulang bila BEI mengubah aturan fraksi.
 */
export function tickSize(price: number): number {
  if (price < 200) return 1;
  if (price < 500) return 2;
  if (price < 2000) return 5;
  if (price < 5000) return 10;
  return 25;
}

/** Jarak dua harga dalam satuan tick (pakai tick harga yang lebih rendah). */
export function tickDistance(a: number, b: number): number {
  return Math.abs(a - b) / tickSize(Math.min(a, b));
}
