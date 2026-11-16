import { describe, expect, it } from "vitest";
import thresholds from "../../src/config/thresholds.json";
import { BigLotThreshold, Clusterer, isSuperBig, minLotByPrice, percentile, sizeCategory, type BigLotConfig } from "../../src/core/bigLot";
import type { Side, Trade } from "../../src/core/types";

const cfg = thresholds.bigLot as BigLotConfig;
const SCALP = thresholds.modes.scalping.minBigValue; // Rp250 jt
const INTRA = thresholds.modes.intraday.minBigValue; // Rp1 M

function tr(ts: number, price: number, lot: number, side: Side, buyer?: string): Trade {
  return { ts, code: "GOTO", price, lot, value: price * lot * 100, side, buyerBroker: buyer, board: "RG", hash: `${ts}` };
}

describe("bigLot", () => {
  it("percentile nearest-rank", () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95)).toBe(95);
    expect(percentile([5], 95)).toBe(5);
  });
  it("minLotByPrice sesuai tabel", () => {
    expect(minLotByPrice(150, cfg.minLotByPrice)).toBe(5000);
    expect(minLotByPrice(200, cfg.minLotByPrice)).toBe(2000);
    expect(minLotByPrice(999, cfg.minLotByPrice)).toBe(2000);
    expect(minLotByPrice(3000, cfg.minLotByPrice)).toBe(500);
    expect(minLotByPrice(9000, cfg.minLotByPrice)).toBe(200);
  });
  it("ambang adaptif = max(P95, minLotByPrice, minValue/(price*100))", () => {
    const b = new BigLotThreshold(cfg);
    // Tanpa riwayat: harga 3.000 scalping -> max(500, ceil(250jt/300.000)=834) = 834
    expect(b.threshold(3000, SCALP)).toBe(834);
    // Intraday: ceil(1M/300.000) = 3334
    expect(b.threshold(3000, INTRA)).toBe(3334);
    // Saham murah 100: minLotByPrice 5000 > ceil(250jt/10.000)=25000? -> 25000 menang
    expect(b.threshold(100, SCALP)).toBe(25000);
    // P95 tinggi mendominasi
    for (let i = 0; i < 500; i++) b.push(i < 470 ? 100 : 10_000);
    expect(b.sampleSize).toBe(500);
    expect(b.threshold(3000, SCALP)).toBe(10_000);
  });
  it("buffer lookback hanya simpan N trade terakhir", () => {
    const b = new BigLotThreshold({ ...cfg, lookbackTrades: 10 });
    for (let i = 0; i < 10; i++) b.push(50_000);
    for (let i = 0; i < 10; i++) b.push(1);
    expect(b.sampleSize).toBe(10);
    expect(b.threshold(9000, 0)).toBe(200);
  });
  it("super besar & kategori ukuran", () => {
    expect(isSuperBig(3000, 1e9, 1000, cfg)).toBe(true);
    expect(isSuperBig(1000, 5e9, 1000, cfg)).toBe(true);
    expect(isSuperBig(2999, 4.9e9, 1000, cfg)).toBe(false);
    expect(sizeCategory(1000, 1000, cfg.mediumRatio)).toBe("BESAR");
    expect(sizeCategory(300, 1000, cfg.mediumRatio)).toBe("SEDANG");
    expect(sizeCategory(299, 1000, cfg.mediumRatio)).toBe("RITEL");
  });
  it("split order: 5 trade jadi 1 cluster", () => {
    const c = new Clusterer(cfg);
    // harga 3.000 (tick 10): 3000, 3010 (+1 tick), 3010, 3000, 3010; jeda <= 3 dtk
    const ts = [0, 1000, 2500, 5000, 7900];
    const px = [3000, 3010, 3010, 3000, 3010];
    let last;
    for (let i = 0; i < 5; i++) last = c.add(tr(ts[i]!, px[i]!, 200, "BUY", "AK"));
    expect(last!.isNew).toBe(false);
    expect(last!.cluster.trades).toBe(5);
    expect(last!.cluster.lot).toBe(1000);
    expect(last!.cluster.broker).toBe("AK");
    // total 1000 lot >= ambang 834 -> lot besar walau tiap trade kecil
    expect(last!.cluster.lot >= new BigLotThreshold(cfg).threshold(3000, SCALP)).toBe(true);
  });
  it("cluster terputus: jeda > 3 dtk, beda sisi, beda broker, lompat > 1 tick", () => {
    const c = new Clusterer(cfg);
    const first = c.add(tr(0, 3000, 100, "BUY", "AK"))!.cluster.id;
    expect(c.add(tr(3001, 3000, 100, "BUY", "AK"))!.isNew).toBe(true); // jeda
    expect(c.add(tr(3500, 3000, 100, "SELL", "AK"))!.isNew).toBe(true); // sisi lain = cluster lain
    expect(c.add(tr(4000, 3000, 100, "BUY", "BK"))!.isNew).toBe(true); // broker beda
    expect(c.add(tr(4500, 3020, 100, "BUY", "BK"))!.isNew).toBe(true); // +2 tick
    expect(c.add(tr(5000, 3020, 100, "BUY"))!.isNew).toBe(false); // broker tak tampil -> boleh gabung
    expect(first).toBe(1);
    expect(c.add(tr(6000, 3000, 100, "UNKNOWN"))).toBeNull();
  });
});
