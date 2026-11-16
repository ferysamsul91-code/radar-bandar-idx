/**
 * Normalisasi teks angka dari layar Stockbit.
 * Aturan:
 *  - Sufiks K/M/B/T = ribu/juta/miliar/triliun ("454.06K", "1,2B").
 *    Dengan sufiks, satu-satunya pemisah dianggap desimal (koma atau titik).
 *  - Tanpa sufiks, pola 1-3 digit + grup 3 digit ("2.180", "3,130", "106.430") = ribuan.
 *  - Jika ada titik DAN koma, pemisah terakhir = desimal ("1.234,5" atau "1,234.5").
 *  - Selain itu satu pemisah = desimal ("1,5", "0.25").
 *  Catatan: "1.500" tanpa sufiks dibaca 1500 (bukan 1,5), sesuai format harga/lot IDX.
 */
const SUFFIX: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

export function parseNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw).replace(/\s| |Rp/gi, "").trim();
  if (!s || s === "-" || s === "—") return null;

  let sign = 1;
  if (s.startsWith("+")) s = s.slice(1);
  else if (s.startsWith("-") || s.startsWith("−")) {
    sign = -1;
    s = s.slice(1);
  }
  // Format akuntansi "(1.234)" = negatif
  if (/^\(.*\)$/.test(s)) {
    sign = -sign;
    s = s.slice(1, -1);
  }

  let mult = 1;
  const last = s.slice(-1).toUpperCase();
  const hasSuffix = last in SUFFIX;
  if (hasSuffix) {
    mult = SUFFIX[last]!;
    s = s.slice(0, -1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;

  let num: number;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    const dec = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const thou = dec === "." ? "," : ".";
    num = Number(s.split(thou).join("").replace(dec, "."));
  } else if (hasDot || hasComma) {
    const sep = hasDot ? "." : ",";
    const parts = s.split(sep);
    const isThousands = !hasSuffix && /^\d{1,3}$/.test(parts[0]!) && parts.slice(1).every((p) => /^\d{3}$/.test(p));
    if (isThousands) num = Number(parts.join(""));
    else if (parts.length === 2) num = Number(`${parts[0]}.${parts[1]}`);
    else return null; // mis. "1.2.3" dengan sufiks: tidak valid
  } else {
    num = Number(s);
  }
  if (!Number.isFinite(num)) return null;
  // Bulatkan ke 15 digit signifikan: 129.2 * 1000 = 129199.99999999999 di floating point.
  return Number((sign * num * mult).toPrecision(15));
}

/** "-1.59%" -> -1.59 (satuan persen). */
export function parsePercent(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).replace("%", "");
  return parseNumber(s);
}

/** Lot selalu bilangan bulat. "1.250" -> 1250, "12,5K" -> 12500. */
export function parseLot(raw: string | null | undefined): number | null {
  const n = parseNumber(raw);
  return n == null ? null : Math.round(n);
}

/** "10:08:17" -> detik sejak tengah malam (null jika tidak valid). */
export function parseTimeOfDay(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const m = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?$/.exec(String(raw).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const se = m[3] ? Number(m[3]) : 0;
  if (h > 23 || mi > 59 || se > 59) return null;
  return h * 3600 + mi * 60 + se;
}

const WIB_OFFSET_MS = 7 * 3600 * 1000;

/** Tanggal bursa (WIB) "YYYY-MM-DD" dari epoch ms. */
export function wibDate(epochMs: number): string {
  return new Date(epochMs + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/** Gabungkan tanggal WIB "YYYY-MM-DD" + jam "10:08:17" -> epoch ms. */
export function toEpochWIB(dateWIB: string, time: string): number | null {
  const secs = parseTimeOfDay(time);
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateWIB);
  if (secs == null || !d) return null;
  return Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])) + secs * 1000 - WIB_OFFSET_MS;
}

/**
 * Jam layar ("16:20:42") -> epoch ms paling dekat yang TIDAK di masa depan.
 * Running trade hanya menampilkan jam; setelah tengah malam / akhir pekan baris yang tampil berasal
 * dari hari bursa sebelumnya, jadi tanggal hari ini akan membuat trade "di masa depan".
 * Toleransi 5 menit untuk selisih jam komputer.
 */
export function screenTimeToEpoch(time: string, now: number, toleranceMs = 5 * 60e3): number | null {
  let ts = toEpochWIB(wibDate(now), time);
  if (ts === null) return null;
  while (ts > now + toleranceMs) ts -= 86400e3;
  return ts;
}

/** Nilai transaksi Rupiah = harga * lot * 100 lembar. */
export function tradeValue(price: number, lot: number): number {
  return price * lot * 100;
}

/** Format Indonesia singkat: 3890000000 -> "+3.89B" (signed=true). */
export function formatCompact(n: number, signed = false): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : signed && n > 0 ? "+" : "";
  const units: [number, string][] = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [v, u] of units) if (abs >= v) return `${sign}${(abs / v).toFixed(2)}${u}`;
  return `${sign}${abs.toLocaleString("id-ID")}`;
}
