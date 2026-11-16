import { describe, expect, it } from "vitest";
import thresholds from "../../src/config/thresholds.json";
import brokers from "../../src/config/brokers.json";
import { BrokerMap } from "../../src/core/brokerMap";
import { computeScore, gradeOf, type ScoreConfig, type ScoreInput } from "../../src/core/scoring";
import { computeStatus, quality, rameLabel, vwapLabel, type StatusConfig } from "../../src/core/status";
import type { WindowMetrics } from "../../src/core/windows";

const sc = thresholds.score as ScoreConfig;
const st = thresholds.status as unknown as StatusConfig;

function wm(p: Partial<WindowMetrics> & { buy?: number; sell?: number }): WindowMetrics {
  const buy = p.buy ?? 0, sell = p.sell ?? 0;
  return {
    buyValue: buy, sellValue: sell, unknownValue: 0, buyPct: buy + sell ? buy / (buy + sell) : null,
    aggrFlow: buy - sell, bigBuy: p.bigBuy ?? 0, bigSell: p.bigSell ?? 0,
    bigNet: (p.bigBuy ?? 0) - (p.bigSell ?? 0), bigShare: null, trades: 10,
  };
}
const B = 1e9;

describe("status", () => {
  const base = { flowKuatAggrFlow: 1 * B, vwapDist: 0, bidBertahan: false };
  it("FLOW KUAT", () => {
    const m = { short: wm({ buy: 1 * B }), mid: wm({ buy: 4 * B, sell: 1 * B, bigBuy: 2 * B }), long: wm({ buy: 5 * B }) };
    expect(computeStatus({ ...base, m }, st)).toBe("FLOW KUAT");
  });
  it("FLOW KUAT gagal jika bigNet <= 0 -> PADA BELI", () => {
    const m = { short: wm({ buy: 1 * B, bigBuy: 1 }), mid: wm({ buy: 4 * B, sell: 1 * B, bigSell: 1 }), long: wm({}) };
    expect(computeStatus({ ...base, m }, st)).toBe("PADA BELI");
  });
  it("CUAN MENANTI butuh bid bertahan & dekat/bawah VWAP", () => {
    const m = { short: wm({ buy: 1, sell: 1 }), mid: wm({ buy: 1, sell: 1 }), long: wm({ buy: 7, sell: 3 }) };
    expect(computeStatus({ ...base, m, vwapDist: -0.01, bidBertahan: true }, st)).toBe("CUAN MENANTI");
    expect(computeStatus({ ...base, m, vwapDist: 0.02, bidBertahan: true }, st)).toBe("NETRAL");
    expect(computeStatus({ ...base, m, vwapDist: -0.01, bidBertahan: false }, st)).toBe("NETRAL");
  });
  it("PADA JUALAN", () => {
    const m = { short: wm({ sell: 1 }), mid: wm({ buy: 1 * B, sell: 4 * B, bigSell: 2 * B }), long: wm({}) };
    expect(computeStatus({ ...base, m }, st)).toBe("PADA JUALAN");
  });
  it("label RAME, VWAP", () => {
    expect(rameLabel(wm({ buy: 7, sell: 3 }), st)).toBe("RAME BELI");
    expect(rameLabel(wm({ buy: 3, sell: 7 }), st)).toBe("RAME JUAL");
    expect(rameLabel(wm({}), st)).toBe("SEPI");
    expect(vwapLabel(0.003, thresholds.vwap)).toBe("DEKAT");
    expect(vwapLabel(-0.015, thresholds.vwap)).toBe("WAJAR");
    expect(vwapLabel(0.03, thresholds.vwap)).toBe("TERLALU JAUH");
  });
});

describe("kualitas data Q", () => {
  const q = thresholds.quality;
  it("data cukup & segar -> 100", () => expect(quality(100, 1000, 2000, 100, q)).toMatchObject({ q: 100, label: null }));
  it("data lama -> DATA LAMA", () => expect(quality(100, 0, 61_000, 100, q)).toMatchObject({ q: 60, stale: true, label: "DATA LAMA" }));
  it("trade sedikit + lama -> DATA BELUM CUKUP", () => expect(quality(3, 0, 61_000, 100, q).label).toBe("DATA BELUM CUKUP"));
  it("parser rendah menurunkan Q", () => expect(quality(100, 1000, 2000, 80, q).q).toBe(85));
});

describe("skor", () => {
  const ideal: ScoreInput = {
    buyPct: 1, aggrFlow: 10 * B, aggrFlowScale: 1 * B, bigNet: 5 * B, totalValue: 5 * B, instNet: 5 * B,
    lifecycle: 1, q: 100, bidDitarik: false, refillOffer: false, nearAra: false, vwapTooFar: false,
  };
  it("kondisi ideal = 100, A+", () => expect(computeScore(ideal, sc)).toMatchObject({ score: 100, grade: "A+" }));
  it("netral (50/50, tanpa data broker) ~ 50", () => {
    const r = computeScore({ ...ideal, buyPct: 0.5, aggrFlow: 0, bigNet: 0, instNet: null, lifecycle: 0.5, q: 100 }, sc);
    expect(r.score).toBe(55);
    expect(r.grade).toBe("");
  });
  it("semua penalti", () => {
    const r = computeScore({ ...ideal, bidDitarik: true, refillOffer: true, nearAra: true, vwapTooFar: true }, sc);
    expect(r.score).toBe(55);
  });
  it("skor tidak keluar dari 0..100", () => {
    const r = computeScore({ ...ideal, buyPct: 0, aggrFlow: -99 * B, bigNet: -5 * B, instNet: -5 * B, lifecycle: 0, q: 0, bidDitarik: true, refillOffer: true }, sc);
    expect(r.score).toBe(0);
  });
  it("grade", () => {
    expect([95, 90, 85, 80, 70, 65, 64].map((s) => gradeOf(s, sc.grades))).toEqual(["A+", "A+", "A", "A", "B", "B", ""]);
  });
});

describe("brokerMap", () => {
  const bm = new BrokerMap(brokers);
  it("[F] selalu asing", () => expect(bm.classify("XL", "F")).toBe("FOREIGN"));
  it("kategori broker dari brokers.json", () => {
    expect(bm.classify("CC")).toBe("LOCAL_INST");
    expect(bm.classify("AK")).toBe("FOREIGN");
    expect(bm.classify("AK", "D")).toBe("LOCAL_INST");
    expect(bm.classify("XL", "D")).toBe("RETAIL");
    expect(bm.classify("ZZ")).toBe("UNKNOWN");
    expect(bm.classify(undefined)).toBe("UNKNOWN");
  });
});

import { AlertManager } from "../../src/core/alerts";
describe("toast notify (pola live)", () => {
  it("cooldown per kunci & antrean maks", () => {
    const a = new AlertManager({ maxQueue: 3, cooldownSec: 60 });
    expect(a.notify("BBCA|BELI", "BBCA", "orange", "x", 0)).not.toBeNull();
    expect(a.notify("BBCA|BELI", "BBCA", "orange", "x", 30_000)).toBeNull();
    expect(a.notify("BBCA|JUAL", "BBCA", "red", "y", 30_000)).not.toBeNull();
    expect(a.notify("BBCA|BELI", "BBCA", "orange", "x", 61_000)).not.toBeNull();
    a.notify("A", "A", "green", "a", 61_000);
    expect(a.queue).toHaveLength(3);
  });
});
