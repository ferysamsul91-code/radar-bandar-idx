import { describe, expect, it } from "vitest";
import { historyDays, makeBackup, parseBackup } from "../../src/core/backup";
import type { BrokerNet } from "../../src/core/instTrace";
import { completeness, histKey, makeReport, putHistory, type RekapHistory } from "../../src/core/rekapRange";

const net = (code: string, broker: string, buy: number, sell: number, buyAvg: number | null = 1000, sellAvg: number | null = 1000): BrokerNet => ({
  code, broker, buy, sell, buyLot: buy / 100_000, sellLot: sell / 100_000, buyAvg, sellAvg, runs: 1,
});

describe("riwayat jejak institusi di REKAP", () => {
  const h: RekapHistory = { fbuy: {}, fsell: {}, inst: {} };
  putHistory(h, "rbInstH:2026-11-12", { day: "2026-11-12", savedAt: 1, nets: [net("ASII", "AK", 2e9, 0), net("ASII", "ZP", 0, 0.5e9), net("BBRI", "BK", 0, 3e9)] });
  putHistory(h, "rbInstH:2026-11-13", { day: "2026-11-13", savedAt: 2, nets: [net("ASII", "AK", 1e9, 0, 1100), net("TLKM", "KZ", 0, 1e9)] });

  it("kunci rbInstH masuk ke riwayat trace", () => {
    expect(Object.keys(h.trace!)).toEqual(["2026-11-12", "2026-11-13"]);
    expect(putHistory(h, "rbInstH:2026-11-01", null)).toBe(true);
  });
  it("sumber JEJAK RT: net per emiten dijumlah semua broker & hari", () => {
    const r = makeReport({ fb: null, fs: null, inst: null }, h, { mode: "custom", from: "2026-11-12", to: "2026-11-13", instSrc: "trace" }, "2026-11-13");
    expect(r.instSource).toContain("jejak running trade 2/2 hari");
    const asii = r.rekap.instOnlyBuy.find((x) => x.code === "ASII")!;
    expect(asii.inst).toBeCloseTo(2.5e9, -3); // 2 − 0,5 + 1
    expect(asii.instAvg).toBe(Math.round((1000 * 20000 + 1100 * 10000) / 30000));
    expect(r.rekap.instOnlySell.map((x) => [x.code, x.inst])).toEqual([["BBRI", -3e9], ["TLKM", -1e9]]);
    expect(r.inst!.brokers.map((b) => b.code)).toEqual(["AK", "BK", "KZ", "ZP"]);
    expect(r.coverage.map((c) => c.trace)).toEqual([true, true]);
  });
  it("mode TERBARU + JEJAK RT memakai jejak hari bursa terakhir", () => {
    const r = makeReport({ fb: null, fs: null, inst: null }, h, { mode: "latest", instSrc: "trace" }, "2026-11-13");
    expect(r.rekap.instOnlyBuy.map((x) => x.code)).toEqual(["ASII"]);
    expect(r.rekap.instOnlySell.map((x) => x.code)).toEqual(["TLKM"]);
  });
});

describe("kelengkapan harian", () => {
  it("menyebut yang belum diambil; institusi cukup dari BA atau jejak", () => {
    const h: RekapHistory = { fbuy: {}, fsell: {}, inst: {}, trace: {} };
    expect(completeness(h, "2026-11-13").missing).toEqual(["asing beli", "asing jual", "institusi"]);
    putHistory(h, histKey("fbuy", "2026-11-13"), { kind: "buy", day: "2026-11-13", capturedAt: 1, rows: [] });
    putHistory(h, "rbInstH:2026-11-13", { day: "2026-11-13", savedAt: 1, nets: [] });
    expect(completeness(h, "2026-11-13")).toMatchObject({ fb: true, fs: false, inst: false, trace: true, missing: ["asing jual"] });
  });
});

describe("cadangan JSON", () => {
  const all = {
    "rbRekapH:fbuy:2026-11-13": { a: 1 }, "rbInstH:2026-11-13": { b: 2 }, "rbSettings": { c: 3 }, "rbBS:BBCA": { d: 4 },
    "rbPos": { left: "1px" }, "lainLain": { x: 1 },
  };
  it("export hanya kunci radar yang relevan", () => {
    const j = JSON.parse(makeBackup(all, Date.UTC(2026, 10, 14)));
    expect(j).toMatchObject({ app: "radar-bandar-idx", version: 1, count: 4, exportedAt: "2026-11-14T00:00:00.000Z" });
    expect(Object.keys(j.items).sort()).toEqual(["rbBS:BBCA", "rbInstH:2026-11-13", "rbRekapH:fbuy:2026-11-13", "rbSettings"]);
  });
  it("import: validasi file & kunci", () => {
    const ok = parseBackup(makeBackup(all, 0));
    expect(ok).toMatchObject({ count: 4, skipped: 0, error: null });
    expect(parseBackup("bukan json").error).toContain("JSON");
    expect(parseBackup(JSON.stringify({ app: "lain", items: {} })).error).toContain("Bukan file cadangan");
    const mixed = parseBackup(JSON.stringify({ app: "radar-bandar-idx", items: { "rbRekapH:fsell:2026-11-12": { r: 1 }, "jahat": { x: 1 }, "rbBS:X": "str" } }));
    expect(mixed).toMatchObject({ count: 1, skipped: 2 });
  });
  it("daftar hari dari kunci riwayat (rentang tidak dihitung sebagai hari)", () => {
    expect(historyDays(["rbRekapH:fbuy:2026-11-12", "rbInstH:2026-11-13", "rbRekapH:inst:2026-11-13_2026-11-13", "rbRekapH:inst:2026-11-07_2026-11-13", "rbBS:BBCA"]))
      .toEqual(["2026-11-13", "2026-11-12"]);
  });
});
