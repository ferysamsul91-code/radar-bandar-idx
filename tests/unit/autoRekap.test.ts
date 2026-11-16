import { describe, expect, it } from "vitest";
import thresholds from "../../src/config/thresholds.json";
import { decideAuto, DEFAULT_AUTO, EMPTY_AUTO_STATE, markRun, sameSet } from "../../src/core/autoRekap";
import type { SessionCfg } from "../../src/core/session";

const S = thresholds.sessions as unknown as SessionCfg;
const wib = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h - 7, m); // 16 Nov 2026 = Senin

describe("jadwal AUTO REKAP", () => {
  const missing = ["asing beli", "asing jual", "institusi"];
  it("final setelah 16:20 pada hari bursa bila belum lengkap", () => {
    expect(decideAuto(wib(16, 16, 10), S, DEFAULT_AUTO, EMPTY_AUTO_STATE, missing)).toBeNull();
    expect(decideAuto(wib(16, 16, 20), S, DEFAULT_AUTO, EMPTY_AUTO_STATE, missing)).toBe("final");
    expect(decideAuto(wib(16, 20, 0), S, DEFAULT_AUTO, EMPTY_AUTO_STATE, [])).toBeNull(); // sudah lengkap
  });
  it("maks 2 percobaan per hari, jeda 3 menit; hari berikutnya dihitung ulang", () => {
    let st = markRun(EMPTY_AUTO_STATE, wib(16, 16, 20), "final", "gagal");
    expect(decideAuto(wib(16, 16, 22), S, DEFAULT_AUTO, st, missing)).toBeNull();
    expect(decideAuto(wib(16, 16, 24), S, DEFAULT_AUTO, st, missing)).toBe("final");
    st = markRun(st, wib(16, 16, 24), "final", "gagal");
    expect(st.attempts).toBe(2);
    expect(decideAuto(wib(16, 17, 0), S, DEFAULT_AUTO, st, missing)).toBeNull();
    expect(decideAuto(wib(17, 16, 30), S, DEFAULT_AUTO, st, missing)).toBe("final");
  });
  it("Sabtu/Minggu & pagi sebelum buka: tidak final; nonaktif: tidak jalan", () => {
    expect(decideAuto(wib(14, 17, 0), S, DEFAULT_AUTO, EMPTY_AUTO_STATE, missing)).toBeNull();
    expect(decideAuto(wib(16, 8, 0), S, DEFAULT_AUTO, EMPTY_AUTO_STATE, missing)).toBeNull();
    expect(decideAuto(wib(16, 16, 30), S, { ...DEFAULT_AUTO, enabled: false }, EMPTY_AUTO_STATE, missing)).toBeNull();
  });
  it("intraday tiap 30 menit selama sesi", () => {
    expect(decideAuto(wib(16, 10, 0), S, DEFAULT_AUTO, EMPTY_AUTO_STATE, missing)).toBe("intraday");
    const st = markRun(EMPTY_AUTO_STATE, wib(16, 10, 0), "intraday", "ok");
    expect(decideAuto(wib(16, 10, 20), S, DEFAULT_AUTO, st, missing)).toBeNull();
    expect(decideAuto(wib(16, 10, 30), S, DEFAULT_AUTO, st, missing)).toBe("intraday");
    expect(decideAuto(wib(16, 12, 30), S, DEFAULT_AUTO, st, missing)).toBeNull(); // istirahat
    expect(decideAuto(wib(16, 10, 30), S, { ...DEFAULT_AUTO, intradayMin: 0 }, st, missing)).toBeNull();
  });
  it("himpunan broker sama tanpa peduli urutan", () => {
    expect(sameSet(["AK", "ZP"], ["ZP", "AK"])).toBe(true);
    expect(sameSet(["AK"], ["AK", "ZP"])).toBe(false);
  });
});
