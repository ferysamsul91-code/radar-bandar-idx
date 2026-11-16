import { describe, expect, it } from "vitest";
import { RunningTradeTracker } from "../../src/core/rtTracker";
import { Deduper } from "../../src/core/dedup";

const rows = (...keys: string[]) => keys.map((key) => ({ key }));

describe("RunningTradeTracker", () => {
  it("muatan awal: semua baris baru, urut lama -> baru", () => {
    const t = new RunningTradeTracker();
    const out = t.ingest(rows("C", "B", "A"));
    expect(out.map((r) => r.key)).toEqual(["A", "B", "C"]);
  });

  it("re-render tanpa perubahan: 0 baru", () => {
    const t = new RunningTradeTracker();
    t.ingest(rows("C", "B", "A"));
    expect(t.ingest(rows("C", "B", "A"))).toEqual([]);
  });

  it("baris baru di atas + baris lama terbuang di bawah", () => {
    const t = new RunningTradeTracker();
    t.ingest(rows("C", "B", "A"));
    const out = t.ingest(rows("E", "D", "C", "B")); // A terbuang
    expect(out.map((r) => r.key)).toEqual(["D", "E"]);
    expect(t.resyncs).toBe(0);
  });

  it("baris identik berulang dihitung sebagai trade berbeda", () => {
    const t = new RunningTradeTracker();
    const d = new Deduper();
    const a = t.ingest(rows("X", "X", "Y"));
    const b = t.ingest(rows("X", "X", "X", "X", "Y")); // 2 X baru
    const all = [...a, ...b];
    expect(b).toHaveLength(2);
    expect(all.filter((r) => r.key === "X").map((r) => r.seq)).toEqual([0, 1, 2, 3]);
    expect(all.every((r) => d.accept(r.hash))).toBe(true);
    expect(d.dupCount).toBe(0);
  });

  it("panel ditutup lalu dibuka lagi: tidak dihitung ulang", () => {
    const t = new RunningTradeTracker();
    t.ingest(rows("C", "B", "A"));
    expect(t.ingest([])).toEqual([]);
    expect(t.ingest(rows("D", "C", "B", "A")).map((r) => r.key)).toEqual(["D"]);
  });

  it("tidak ada tumpang-tindih: semua baru + resync tercatat", () => {
    const t = new RunningTradeTracker();
    t.ingest(rows("C", "B", "A"));
    expect(t.ingest(rows("Z", "Y")).map((r) => r.key)).toEqual(["Y", "Z"]);
    expect(t.resyncs).toBe(1);
  });

  it("80 baris, 5 baru per tick, 200 tick: total tepat", () => {
    const t = new RunningTradeTracker();
    const all: string[] = [];
    let total = 0;
    for (let tick = 0; tick < 200; tick++) {
      for (let i = 0; i < 5; i++) all.unshift(`T${tick}-${i % 2}`); // pola berulang
      total += t.ingest(rows(...all.slice(0, 80))).length;
    }
    expect(total).toBe(1000);
  });
});
