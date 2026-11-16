import { describe, expect, it } from "vitest";
import { DEFAULT_INST_TRACE, InstTraceTracker } from "../../src/core/instTrace";
import type { Trade } from "../../src/core/types";

const T0 = Date.UTC(2026, 10, 16, 3, 0, 0); // 10:00 WIB
let n = 0;
/** Trade harga 1.000: value = lot * 100.000. 1.000 lot = Rp100 jt. */
function tr(sec: number, lot: number, buyer: string, seller: string, extra: Partial<Trade> = {}): Trade {
  const price = extra.price ?? 1000;
  return { ts: T0 + sec * 1000, code: "TEST", price, lot, value: price * lot * 100, side: "BUY", buyerBroker: buyer, sellerBroker: seller, board: "RG", hash: String(n++), ...extra };
}

describe("JEJAK INSTITUSI", () => {
  it("3 trade AK beli @Rp400 jt dalam 2 menit -> 1 kejadian BELI (Rp1,2 M); penjual YP tidak lolos sendiri", () => {
    const k = new InstTraceTracker(DEFAULT_INST_TRACE);
    expect(k.add(tr(0, 4000, "AK", "YP"))).toEqual([]);
    expect(k.add(tr(60, 4000, "AK", "PD"))).toEqual([]);
    const ev = k.add(tr(120, 4000, "AK", "CC"));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ code: "TEST", broker: "AK", side: "BELI", trades: 3, lot: 12000, value: 1.2e9, avg: 1000 });
    expect(k.events).toHaveLength(1);
  });

  it("broker ritel XL & XC dikecualikan (sebagai pembeli maupun penjual)", () => {
    const k = new InstTraceTracker(DEFAULT_INST_TRACE);
    for (let i = 0; i < 5; i++) k.add(tr(i * 30, 5000, "XL", "XC"));
    expect(k.events).toEqual([]);
    for (let i = 0; i < 3; i++) k.add(tr(200 + i * 30, 5000, "XC", "BK"));
    expect(k.events.map((e) => `${e.broker} ${e.side}`)).toEqual(["BK JUAL"]);
  });

  it("jeda > 5 menit memutus rangkaian; trade kecil (< Rp100 jt) tidak dihitung", () => {
    const k = new InstTraceTracker(DEFAULT_INST_TRACE);
    k.add(tr(0, 4000, "ZP", "YP"));
    k.add(tr(100, 4000, "ZP", "YP"));
    k.add(tr(100 + 301, 4000, "ZP", "YP")); // jeda 301 dtk -> rangkaian baru
    expect(k.events).toEqual([]);
    for (let i = 0; i < 10; i++) k.add(tr(500 + i, 900, "KZ", "YP")); // Rp90 jt per trade
    expect(k.events).toEqual([]);
  });

  it("order dipecah dari broker yang sama terjumlah; update kejadian tanpa duplikat", () => {
    const k = new InstTraceTracker(DEFAULT_INST_TRACE);
    for (let i = 0; i < 12; i++) k.add(tr(i * 20, 1000, "RX", "PD", { price: 1000 + (i % 2) * 5 })); // 12 x Rp100 jt
    // RX beli & PD jual sama-sama memenuhi syarat (hanya XL/XC yang dikecualikan bawaan)
    expect(k.events.map((e) => `${e.broker} ${e.side}`).sort()).toEqual(["PD JUAL", "RX BELI"]);
    const rx = k.events.find((e) => e.broker === "RX")!;
    expect(rx).toMatchObject({ side: "BELI", trades: 12, lot: 12000 });
    expect(rx.value).toBeCloseTo(1.203e9, -6);
    expect(rx.avg).toBe(1003); // rata-rata tertimbang lot (1000 & 1005)
  });

  it("trade silang (broker beli = jual) dilewati; NG diabaikan; porsi [F]", () => {
    const k = new InstTraceTracker(DEFAULT_INST_TRACE);
    for (let i = 0; i < 4; i++) k.add(tr(i, 5000, "AK", "AK"));
    for (let i = 0; i < 4; i++) k.add(tr(i, 5000, "BK", "YP", { board: "NG" }));
    expect(k.events).toEqual([]);
    k.add(tr(10, 5000, "BK", "YP", { buyerType: "F" }));
    k.add(tr(20, 5000, "BK", "YP", { buyerType: "F" }));
    k.add(tr(30, 5000, "BK", "YP", { buyerType: "D" }));
    expect(k.events.find((e) => e.broker === "BK")!.foreignShare).toBeCloseTo(2 / 3, 5);
    expect(k.events.find((e) => e.broker === "YP")!.foreignShare).toBeNull();
  });

  it("net per broker per emiten", () => {
    const k = new InstTraceTracker(DEFAULT_INST_TRACE);
    for (let i = 0; i < 3; i++) k.add(tr(i * 10, 5000, "AK", "YP")); // AK beli 1,5 M
    for (let i = 0; i < 3; i++) k.add(tr(1000 + i * 10, 4000, "YP", "AK", { price: 1010 })); // AK jual ~1,21 M
    const net = k.nets().find((x) => x.broker === "AK")!;
    expect(net).toMatchObject({ code: "TEST", buy: 1.5e9, buyLot: 15000, sellLot: 12000, buyAvg: 1000, sellAvg: 1010, runs: 2 });
    expect(net.sell).toBeCloseTo(1.212e9, -6);
    expect(k.isActive(k.events[0]!, T0 + 1020 * 1000 + 299_000)).toBe(true);
    expect(k.isActive(k.events[0]!, T0 + 1020 * 1000 + 301_000)).toBe(false);
  });

  it("daftar pengecualian bisa diubah", () => {
    const k = new InstTraceTracker({ ...DEFAULT_INST_TRACE, excludeBrokers: ["xl", "xc", "yp"] });
    expect(k.excludedBrokers).toEqual(["XL", "XC", "YP"]);
    for (let i = 0; i < 3; i++) k.add(tr(i, 5000, "YP", "PD"));
    expect(k.events.map((e) => e.broker)).toEqual(["PD"]);
  });
});
