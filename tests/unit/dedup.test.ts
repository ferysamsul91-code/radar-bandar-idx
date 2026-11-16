import { describe, expect, it } from "vitest";
import { Deduper, tradeHash } from "../../src/core/dedup";

describe("dedup", () => {
  const row = { code: "BBRI", time: "10:08:17", price: 4010, lot: 50, buyer: "AK", seller: "YP" };

  it("format hash code|time|price|lot|buyer|seller|urutan", () => {
    expect(tradeHash({ ...row, seq: 0 })).toBe("BBRI|10:08:17|4010|50|AK|YP|0");
    expect(tradeHash({ code: "X", time: "1", price: 1, lot: 1, seq: 2 })).toBe("X|1|1|1|||2");
  });

  it("re-render DOM tidak dihitung dua kali", () => {
    const d = new Deduper();
    const render1 = [tradeHash({ ...row, seq: 0 }), tradeHash({ ...row, seq: 1 })]; // 2 trade identik sah
    const render2 = [...render1, tradeHash({ ...row, lot: 10, seq: 0 })]; // re-render + 1 trade baru
    const accepted = [...render1, ...render2].filter((h) => d.accept(h));
    expect(accepted).toHaveLength(3);
    expect(d.dupCount).toBe(2);
  });

  it("kapasitas terbatas membuang hash tertua", () => {
    const d = new Deduper(3);
    ["a", "b", "c", "d"].forEach((h) => d.accept(h));
    expect(d.accept("a")).toBe(true); // "a" sudah terbuang
    expect(d.accept("d")).toBe(false);
    d.reset();
    expect(d.dupCount).toBe(0);
  });
});
