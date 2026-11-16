import { describe, expect, it } from "vitest";
import { formatCompact, parseLot, parseNumber, parsePercent, parseTimeOfDay, screenTimeToEpoch, toEpochWIB, tradeValue, wibDate } from "../../src/core/normalize";

describe("normalize", () => {
  it("angka dengan sufiks", () => {
    expect(parseNumber("1,2B")).toBeCloseTo(1.2e9);
    expect(parseNumber("454.06K")).toBeCloseTo(454060);
    expect(parseNumber("+3.89B")).toBeCloseTo(3.89e9);
    expect(parseNumber("-6.35B")).toBeCloseTo(-6.35e9);
    expect(parseNumber("12M")).toBe(12e6);
  });
  it("pemisah ribuan format IDX", () => {
    expect(parseNumber("2.180")).toBe(2180);
    expect(parseNumber("3,130")).toBe(3130);
    expect(parseNumber("106.430")).toBe(106430);
    expect(parseNumber("1.234.567")).toBe(1234567);
  });
  it("desimal & campuran", () => {
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber("0.25")).toBe(0.25);
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("Rp 2.500")).toBe(2500);
    expect(parseNumber("(1.000)")).toBe(-1000);
  });
  it("input tidak valid -> null", () => {
    for (const s of ["", "-", "—", "abc", null, undefined, "1.2.3K"]) expect(parseNumber(s as string)).toBeNull();
  });
  it("persen", () => {
    expect(parsePercent("-1.59%")).toBeCloseTo(-1.59);
    expect(parsePercent("+2.62%")).toBeCloseTo(2.62);
    expect(parsePercent("0,5%")).toBeCloseTo(0.5);
  });
  it("lot dibulatkan", () => {
    expect(parseLot("1.250")).toBe(1250);
    expect(parseLot("12,5K")).toBe(12500);
  });
  it("jam bursa WIB", () => {
    expect(parseTimeOfDay("10:08:17")).toBe(10 * 3600 + 8 * 60 + 17);
    expect(parseTimeOfDay("09:00")).toBe(9 * 3600);
    expect(parseTimeOfDay("25:00:00")).toBeNull();
    const ts = toEpochWIB("2026-11-13", "10:08:17")!;
    expect(new Date(ts).toISOString()).toBe("2026-11-13T03:08:17.000Z");
    expect(wibDate(ts)).toBe("2026-11-13");
  });
  it("nilai & format", () => {
    expect(tradeValue(3130, 1000)).toBe(313_000_000);
    expect(formatCompact(3.89e9, true)).toBe("+3.89B");
    expect(formatCompact(-6.35e9)).toBe("-6.35B");
    expect(formatCompact(454060)).toBe("454.06K");
  });
});

describe("screenTimeToEpoch: jam layar tidak boleh di masa depan", () => {
  const at = (d: number, h: number, m: number) => Date.UTC(2026, 10, d, h - 7, m); // WIB
  it("jam sesi hari ini tetap hari ini", () => {
    expect(screenTimeToEpoch("10:08:17", at(13, 10, 9))).toBe(at(13, 10, 8) + 17_000);
  });
  it("lewat tengah malam: trade 16:20 dianggap kemarin", () => {
    expect(screenTimeToEpoch("16:20:00", at(14, 1, 30))).toBe(at(13, 16, 20));
  });
  it("selisih jam komputer <= 5 menit tidak digeser", () => {
    expect(screenTimeToEpoch("10:03:00", at(13, 10, 0))).toBe(at(13, 10, 3));
  });
  it("jam tidak valid -> null", () => expect(screenTimeToEpoch("x", at(13, 10, 0))).toBeNull());
});
