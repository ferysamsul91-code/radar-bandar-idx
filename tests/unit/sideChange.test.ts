import { describe, expect, it } from "vitest";
import thresholds from "../../src/config/thresholds.json";
import { SideChangeTracker } from "../../src/core/sideChange";

const S = 1000;
const cfg = thresholds.status.sideChange;

describe("pergantian sisi", () => {
  it("sisi awal tidak dihitung sebagai pergantian", () => {
    const sc = new SideChangeTracker(cfg);
    sc.update(0, "BELI");
    expect(sc.side).toBe("BELI");
    expect(sc.last).toBeNull();
  });

  it("belum terkonfirmasi < 20 dtk walau lot besar cukup", () => {
    const sc = new SideChangeTracker(cfg);
    sc.update(0, "BELI");
    sc.update(1 * S, "JUAL");
    sc.addBig(2 * S, "SELL");
    sc.addBig(3 * S, "SELL");
    sc.update(19 * S, "JUAL");
    expect(sc.side).toBe("BELI");
    expect(sc.pending).toMatchObject({ to: "JUAL", big: 2 });
  });

  it("belum terkonfirmasi >= 20 dtk tapi lot besar < 2", () => {
    const sc = new SideChangeTracker(cfg);
    sc.update(0, "BELI");
    sc.update(1 * S, "JUAL");
    sc.addBig(2 * S, "SELL");
    sc.addBig(3 * S, "BUY"); // sisi lama, tidak dihitung
    sc.update(30 * S, "JUAL");
    expect(sc.side).toBe("BELI");
  });

  it("terkonfirmasi setelah 20 dtk + 2 lot besar di sisi baru", () => {
    const sc = new SideChangeTracker(cfg);
    sc.update(0, "BELI");
    sc.update(1 * S, "JUAL");
    sc.addBig(5 * S, "SELL");
    sc.addBig(9 * S, "SELL");
    sc.update(21 * S, "JUAL");
    expect(sc.side).toBe("JUAL");
    expect(sc.last).toEqual({ from: "BELI", to: "JUAL", at: 21 * S });
    expect(sc.pending).toBeNull();
  });

  it("kondisi kembali ke sisi lama membatalkan pending", () => {
    const sc = new SideChangeTracker(cfg);
    sc.update(0, "BELI");
    sc.update(1 * S, "JUAL");
    sc.addBig(2 * S, "SELL");
    sc.update(10 * S, "BELI");
    expect(sc.pending).toBeNull();
    sc.update(11 * S, "JUAL"); // mulai ulang dari nol
    sc.addBig(12 * S, "SELL");
    sc.update(25 * S, "JUAL");
    expect(sc.side).toBe("BELI");
  });
});
