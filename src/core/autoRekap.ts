/**
 * Jadwal AUTO REKAP: ekstensi mengambil Movers (asing) & Broker Analysis (institusi) sendiri lewat iframe tersembunyi
 * di halaman Stockbit yang sedang dibuka pengguna. Tanpa API, tanpa kirim data; hanya mengklik tab/chip di Stockbit.
 *  - "final"    : hari bursa, setelah afterWIB (16:20), bila REKAP hari itu belum lengkap; maks maxAttempts kali per hari.
 *  - "intraday" : selama SESI 1/SESI 2, tiap intradayMin menit, hanya Movers (data asing sementara).
 */
import { hhmmToMin, lastTradingDate, marketPhase, wibClock, type SessionCfg } from "./session";

export interface AutoRekapCfg {
  enabled: boolean;
  afterWIB: string;
  intradayMin: number;
  brokers: string[];
  maxAttempts: number;
}
export const DEFAULT_AUTO: AutoRekapCfg = { enabled: true, afterWIB: "16:20", intradayMin: 30, brokers: ["AK", "ZP", "BK", "KZ", "RX"], maxAttempts: 2 };

export interface AutoState {
  /** Hari bursa (YYYY-MM-DD) untuk hitungan percobaan final. */
  day: string;
  attempts: number;
  lastRun: number;
  lastIntraday: number;
  lastResult: string;
}
export const EMPTY_AUTO_STATE: AutoState = { day: "", attempts: 0, lastRun: 0, lastIntraday: 0, lastResult: "" };
export const AUTO_KEY = "rbAutoRekap";

export type AutoMode = "final" | "intraday";

export function decideAuto(now: number, sessions: SessionCfg, cfg: AutoRekapCfg, st: AutoState, missingToday: string[]): AutoMode | null {
  if (!cfg.enabled) return null;
  const { min, day, date } = wibClock(now);
  const weekday = day >= 1 && day <= 5;
  const phase = marketPhase(now, sessions);
  const tradingToday = lastTradingDate(now, sessions) === date;
  const after = hhmmToMin(cfg.afterWIB) ?? 980;
  const attempts = st.day === date ? st.attempts : 0;
  if (weekday && tradingToday && min >= after && missingToday.length > 0 && attempts < cfg.maxAttempts && now - st.lastRun > 3 * 60e3) return "final";
  if (cfg.intradayMin > 0 && (phase === "SESI 1" || phase === "SESI 2") && now - st.lastIntraday >= cfg.intradayMin * 60e3 && now - st.lastRun > 60e3) return "intraday";
  return null;
}

/** Catat percobaan. */
export function markRun(st: AutoState, now: number, mode: AutoMode, result: string): AutoState {
  const { date } = wibClock(now);
  if (mode === "intraday") return { ...st, lastRun: now, lastIntraday: now, lastResult: result };
  return { ...st, day: date, attempts: (st.day === date ? st.attempts : 0) + 1, lastRun: now, lastResult: result };
}

export const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
