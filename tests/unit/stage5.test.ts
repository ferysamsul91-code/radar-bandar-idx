import { describe, expect, it } from "vitest";
import brokers from "../../src/config/brokers.json";
import thresholds from "../../src/config/thresholds.json";
import { AlertManager } from "../../src/core/alerts";
import type { EmitenView } from "../../src/core/engine";
import { parseJSONL, tradesToCSV, tradesToJSONL } from "../../src/core/exporter";
import { marketPhase, tradingDayKey, type SessionCfg } from "../../src/core/session";
import { brokerRows, defaultSettings, loadSettings, mergeChecked, parseCodeList, rowsToBrokerTable } from "../../src/core/settings";
import type { Trade } from "../../src/core/types";
import { arrangeViews } from "../../src/content/actions";

/** Waktu WIB -> epoch. Bulan 1-based. */
const wib = (y: number, mo: number, d: number, h: number, mi: number) => Date.UTC(y, mo - 1, d, h - 7, mi);
const sess = thresholds.sessions as unknown as SessionCfg;

describe("jam sesi", () => {
  // 2026-11-13 = Jumat, 2026-11-12 = Kamis, 2026-11-14 = Sabtu
  it.each([
    [wib(2026, 11, 12, 8, 50), "PRA-BUKA"],
    [wib(2026, 11, 12, 10, 0), "SESI 1"],
    [wib(2026, 11, 12, 12, 30), "ISTIRAHAT"],
    [wib(2026, 11, 12, 14, 0), "SESI 2"],
    [wib(2026, 11, 12, 15, 55), "PRA-TUTUP"],
    [wib(2026, 11, 12, 17, 0), "TUTUP"],
    [wib(2026, 11, 13, 11, 45), "ISTIRAHAT"],
    [wib(2026, 11, 13, 13, 45), "ISTIRAHAT"],
    [wib(2026, 11, 13, 14, 5), "SESI 2"],
    [wib(2026, 11, 14, 10, 0), "TUTUP"],
  ])("%s -> %s", (t, p) => expect(marketPhase(t, sess)).toBe(p));

  it("reset harian 08:45: sebelum jam reset masih hari kemarin", () => {
    expect(tradingDayKey(wib(2026, 11, 13, 8, 44), "08:45")).toBe("2026-11-12");
    expect(tradingDayKey(wib(2026, 11, 13, 8, 45), "08:45")).toBe("2026-11-13");
    expect(tradingDayKey(wib(2026, 11, 13, 23, 59), "08:45")).toBe("2026-11-13");
    expect(tradingDayKey(wib(2026, 11, 14, 0, 30), "08:45")).toBe("2026-11-13");
  });
});

function v(code: string, status: EmitenView["status"], grade: "A+" | "A" | "B" | null = null, aggr = 3.89e9, q = 100): EmitenView {
  return { code, status, q, score: { score: 50, grade, parts: {} }, m: { mid: { aggrFlow: aggr } } } as unknown as EmitenView;
}

describe("toast", () => {
  it("muncul saat masuk FLOW KUAT / PADA JUALAN / A+, tidak berulang selama status sama", () => {
    const a = new AlertManager({ maxQueue: 3, cooldownSec: 60 });
    expect(a.evaluate([v("MDKA", "NETRAL")], 0)).toEqual([]);
    const t1 = a.evaluate([v("MDKA", "FLOW KUAT")], 1000);
    expect(t1).toHaveLength(1);
    expect(t1[0]).toMatchObject({ kind: "green", text: "MDKA: FLOW KUAT • AGGR FLOW +3.89B" });
    expect(a.evaluate([v("MDKA", "FLOW KUAT")], 2000)).toEqual([]);
    expect(a.evaluate([v("ENRG", "PADA JUALAN", null, -6.35e9)], 2000)[0]).toMatchObject({ kind: "red", text: "ENRG: PADA JUALAN • AGGR FLOW -6.35B" });
    expect(a.evaluate([v("GOTO", "PADA BELI", "A+")], 2000)[0]).toMatchObject({ kind: "orange", text: "GOTO: A+ KONFLUENSI • PRIORITAS PANTAU" });
  });

  it("cooldown 60 dtk per emiten", () => {
    const a = new AlertManager({ maxQueue: 3, cooldownSec: 60 });
    expect(a.evaluate([v("X", "FLOW KUAT")], 0)).toHaveLength(1);
    a.evaluate([v("X", "NETRAL")], 10_000);
    expect(a.evaluate([v("X", "FLOW KUAT")], 30_000)).toHaveLength(0);
    a.evaluate([v("X", "NETRAL")], 40_000);
    expect(a.evaluate([v("X", "FLOW KUAT")], 61_000)).toHaveLength(1);
  });

  it("antrean maks 3, kedaluwarsa, filter & Q rendah", () => {
    const a = new AlertManager({ maxQueue: 3, cooldownSec: 60, ttlSec: 10 });
    a.evaluate(["A1", "B1", "C1", "D1", "E1"].map((c) => v(c, "FLOW KUAT")), 0);
    expect(a.queue.map((t) => t.code)).toEqual(["C1", "D1", "E1"]);
    a.evaluate([], 11_000);
    expect(a.queue).toEqual([]);
    expect(a.evaluate([v("BL", "FLOW KUAT")], 12_000, (c) => c !== "BL")).toEqual([]);
    expect(a.evaluate([v("LOWQ", "FLOW KUAT", null, 1e9, 40)], 12_000)).toEqual([]);
  });
});

const T: Trade[] = [
  { ts: wib(2026, 11, 13, 10, 0), code: "BBCA", price: 5500, lot: 1500, value: 825_000_000, side: "BUY", buyerBroker: "AK", buyerType: "F", sellerBroker: "XL", sellerType: "D", board: "RG", hash: "a|0" },
  { ts: wib(2026, 11, 13, 10, 0) + 1000, code: "TLKM", price: 2150, lot: 3000, value: 645_000_000, side: "SELL", board: "RG", hash: 'b,"x"|0' },
];

describe("export", () => {
  it("CSV: header, waktu WIB, escape koma/kutip", () => {
    const lines = tradesToCSV(T).trim().split("\n");
    expect(lines[0]).toBe("ts,waktu_wib,code,price,lot,value,side,buyer,buyer_type,seller,seller_type,board,hash");
    expect(lines[1]).toContain("2026-11-13T10:00:00.000+07:00,BBCA,5500,1500,825000000,BUY,AK,F,XL,D,RG,a|0");
    expect(lines[2]!.endsWith(',RG,"b,""x""|0"')).toBe(true);
  });
  it("JSONL bolak-balik sama, baris rusak dilewati", () => {
    const text = tradesToJSONL(T);
    expect(text.split("\n").filter(Boolean)).toHaveLength(2);
    expect(parseJSONL(text + "rusak\n{}\n")).toEqual(T);
  });
});

describe("settings", () => {
  const base = thresholds as unknown as Record<string, unknown>;
  it("mergeChecked: terima kunci yang ada, tolak kunci asing & tipe salah", () => {
    const r = mergeChecked(base, { toast: { cooldownSec: 30 }, quality: { minTrades: "x" }, salah: 1 });
    expect((r.value as { toast: { cooldownSec: number; maxQueue: number } }).toast).toMatchObject({ cooldownSec: 30, maxQueue: 3 });
    expect((r.value as { quality: { minTrades: number } }).quality.minTrades).toBe(30);
    expect(r.errors).toEqual(["quality.minTrades: harus number, bukan string", "salah: kunci tidak dikenal"]);
  });
  it("kode emiten dirapikan", () => expect(parseCodeList("bbca, tlkm  goto;BBCA x !!")).toEqual(["BBCA", "TLKM", "GOTO"]));
  it("tabel broker bolak-balik, kode ganda: baris terakhir menang", () => {
    const rows = brokerRows(brokers);
    expect(rows.length).toBeGreaterThan(10);
    const back = rowsToBrokerTable(rows);
    expect(brokerRows(back)).toEqual(rows);
    const t = rowsToBrokerTable([{ code: "ak", cat: "FOREIGN_INST", name: "A" }, { code: "AK", cat: "RETAIL_HEAVY", name: "B" }, { code: "", cat: "LOCAL_INST", name: "kosong" }]);
    expect(t).toMatchObject({ FOREIGN_INST: {}, LOCAL_INST: {}, RETAIL_HEAVY: { AK: "B" } });
  });
  it("loadSettings: simpanan rusak -> default, wsTap selalu OFF", () => {
    const d = defaultSettings(base, brokers);
    expect(loadSettings(null, d)).toBe(d);
    const s = loadSettings({ watchlist: ["bbca"], blacklist: "x", wsTap: true, sound: true, thresholds: { toast: { cooldownSec: 5 } } }, d);
    expect(s).toMatchObject({ watchlist: ["BBCA"], blacklist: [], wsTap: false, sound: true });
    expect((s.thresholds.toast as { cooldownSec: number }).cooldownSec).toBe(5);
    expect((d.thresholds.toast as { cooldownSec: number }).cooldownSec).toBe(60);
  });
});

describe("watchlist / blacklist", () => {
  it("watchlist di atas, blacklist dibuang, urutan skor lain tetap", () => {
    const xs = ["AAAA", "BBBB", "CCCC", "DDDD"].map((c) => v(c, "NETRAL"));
    expect(arrangeViews(xs, new Set(["CCCC"]), new Set(["BBBB"])).map((x) => x.code)).toEqual(["CCCC", "AAAA", "DDDD"]);
  });
});
