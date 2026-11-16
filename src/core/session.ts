/**
 * Jam sesi BEI (WIB, UTC+7) dan kunci hari bursa untuk reset harian.
 * Jadwal default dari spesifikasi; hari libur bursa TIDAK diketahui (dianggap hari biasa).
 */
export type Phase = "PRA-BUKA" | "SESI 1" | "ISTIRAHAT" | "SESI 2" | "PRA-TUTUP" | "TUTUP";

export interface DaySchedule {
  sesi1: [string, string];
  sesi2: [string, string];
}
export interface SessionCfg {
  preOpen: [string, string];
  weekday: DaySchedule;
  friday: DaySchedule;
  preClose: [string, string];
}

const WIB = 7 * 3600e3;

export function hhmmToMin(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

/** Menit sejak 00:00 WIB dan hari (0 = Minggu) menurut WIB. */
export function wibClock(now: number): { min: number; day: number; date: string } {
  const d = new Date(now + WIB);
  return { min: d.getUTCHours() * 60 + d.getUTCMinutes(), day: d.getUTCDay(), date: d.toISOString().slice(0, 10) };
}

const inRange = (m: number, r: [string, string]) => {
  const a = hhmmToMin(r[0]);
  const b = hhmmToMin(r[1]);
  return a !== null && b !== null && m >= a && m <= b;
};

export function marketPhase(now: number, cfg: SessionCfg): Phase {
  const { min, day } = wibClock(now);
  if (day === 0 || day === 6) return "TUTUP";
  const sch = day === 5 ? cfg.friday : cfg.weekday;
  if (inRange(min, cfg.preOpen)) return "PRA-BUKA";
  if (inRange(min, sch.sesi1)) return "SESI 1";
  if (inRange(min, sch.sesi2)) return "SESI 2";
  if (inRange(min, cfg.preClose)) return "PRA-TUTUP";
  const s1End = hhmmToMin(sch.sesi1[1]) ?? 0;
  const s2Start = hhmmToMin(sch.sesi2[0]) ?? 0;
  if (min > s1End && min < s2Start) return "ISTIRAHAT";
  return "TUTUP";
}

/**
 * Kunci hari bursa: tanggal WIB, tetapi sebelum jam reset (mis. 08:45) masih dihitung hari sebelumnya.
 * Data direset saat kunci ini berubah.
 */
export function tradingDayKey(now: number, resetHHMM: string): string {
  const reset = hhmmToMin(resetHHMM) ?? 525;
  const { min } = wibClock(now);
  return min < reset ? wibClock(now - 86400e3).date : wibClock(now).date;
}

/**
 * Hari bursa yang datanya sedang tampil: hari ini bila sudah lewat jam buka sesi 1,
 * selain itu hari kerja sebelumnya. Sabtu/Minggu -> Jumat. Hari libur bursa TIDAK diketahui (ESTIMASI).
 */
export function lastTradingDate(now: number, cfg: SessionCfg): string {
  const DAY = 86400e3;
  const { min, day } = wibClock(now);
  const open = hhmmToMin((day === 5 ? cfg.friday : cfg.weekday).sesi1[0]) ?? 540;
  let t = now;
  let d = day;
  if (d >= 1 && d <= 5 && min >= open) return wibClock(t).date;
  do {
    t -= DAY;
    d = (d + 6) % 7;
  } while (d === 0 || d === 6);
  return wibClock(t).date;
}
