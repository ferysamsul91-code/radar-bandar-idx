// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PdfDoc, textWidth, toBytes, toWinAnsi, wrapText } from "../../src/core/pdf";
import { parseShortDate, type ForeignSnap, type InstSnap } from "../../src/core/rekap";
import { parseBrokerAnalysis, parseMoversForeign } from "../../src/content/parse-rekap";
import { rekapPdf } from "../../src/ui/rekapPdf";
import { histKey, makeReport, putHistory, type RekapHistory } from "../../src/core/rekapRange";

const EMPTY: RekapHistory = { fbuy: {}, fsell: {}, inst: {} };

/** Validasi struktur: setiap entri xref menunjuk tepat ke "N 0 obj". */
function checkXref(pdf: string) {
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)![1]);
  expect(pdf.slice(start, start + 4)).toBe("xref");
  const [, count] = /xref\n0 (\d+)\n/.exec(pdf.slice(start))!;
  const entries = pdf.slice(start).split("\n").slice(3, 3 + Number(count) - 1);
  entries.forEach((e, i) => {
    const off = Number(e.slice(0, 10));
    expect(pdf.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
  });
  for (const m of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const s = m.index! + m[0].length;
    expect(pdf.slice(s + Number(m[1]!), s + Number(m[1]!) + 10)).toBe("\nendstream");
  }
}

describe("penulis PDF mini", () => {
  it("struktur valid, karakter di luar WinAnsi jadi ?", () => {
    const d = new PdfDoc();
    const p = d.addPage();
    d.text(p, 40, 800, "Halo (dunia) \\ • – ✅", { size: 12 });
    d.line(p, 40, 790, 200, 790);
    d.rect(p, 40, 700, 100, 50, [255, 0, 0]);
    const pdf = d.build("Uji");
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf).toContain("(Halo \\(dunia\\) \\\\ \x95 \x96 ?) Tj");
    expect(pdf).toContain("/Count 1");
    checkXref(pdf);
    expect([...pdf].every((c) => c.charCodeAt(0) < 256)).toBe(true);
    expect(toBytes(pdf).length).toBe(pdf.length);
  });
  it("lebar teks & bungkus baris", () => {
    expect(textWidth("0000", 10)).toBeCloseTo(22.24, 2);
    expect(textWidth("A", 10, "F2")).toBeCloseTo(7.22, 2);
    const lines = wrapText("satu dua tiga empat lima enam tujuh delapan", 10, 60);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.every((l) => textWidth(l, 10) <= 60 || !l.includes(" "))).toBe(true);
    expect(toWinAnsi("é…")).toBe("é\x85");
  });
});

describe("PDF REKAP dari fixture asli 13 Nov 26", () => {
  const fx = (f: string) => readFileSync(resolve(import.meta.dirname, "../../fixtures", f), "utf8");
  const rows = (f: string) => {
    document.body.innerHTML = fx(f);
    return parseMoversForeign(document).rows;
  };
  const fb: ForeignSnap = { kind: "buy", capturedAt: Date.UTC(2026, 10, 13, 9, 30), day: "2026-11-13", rows: rows("movers-net-foreign-buy.html") };
  const fs: ForeignSnap = { kind: "sell", capturedAt: Date.UTC(2026, 10, 13, 9, 30), day: "2026-11-13", rows: rows("movers-net-foreign-sell.html") };
  document.body.innerHTML = fx("broker-analysis.html");
  const ba = parseBrokerAnalysis(document);
  const inst: InstSnap = { capturedAt: Date.UTC(2026, 10, 13, 9, 31), day: parseShortDate(ba.dateText), ...ba };

  it("berisi judul, kelompok, angka & kaki halaman; xref valid", () => {
    const pdf = rekapPdf(makeReport({ fb, fs, inst }, EMPTY, { mode: "latest" }, "2026-11-13"), Date.UTC(2026, 10, 13, 10, 0));
    checkXref(pdf);
    for (const s of ["Rekap Penutupan", "Hari bursa 2026-11-13", "SAMA-SAMA BELI \\(16\\)", "SAMA-SAMA JUAL \\(6\\)", "BERLAWANAN ARAH \\(2\\)", "(ASII) Tj", "(+78,63B) Tj", "(5.462) Tj", "Bukan rekomendasi beli/jual", "hal 1/"]) {
      expect(pdf).toContain(s);
    }
    const pages = Number(/\/Count (\d+)/.exec(pdf)![1]);
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(pdf).toContain(`hal ${pages}/${pages}`);
  });
  it("mode rentang: label rentang, total, ketersediaan per hari", () => {
    const h: RekapHistory = { fbuy: {}, fsell: {}, inst: {} };
    putHistory(h, histKey("fbuy", "2026-11-13"), fb);
    putHistory(h, histKey("fsell", "2026-11-13"), fs);
    putHistory(h, histKey("inst", "2026-11-13", "2026-11-13"), inst);
    const pdf = rekapPdf(makeReport({ fb, fs, inst }, h, { mode: "5d" }, "2026-11-13"), Date.UTC(2026, 10, 13, 10, 0));
    checkXref(pdf);
    for (const s of ["Rentang 6 Nov 2026 - 13 Nov 2026", "KETERSEDIAAN DATA PER HARI BURSA", "Asing total net beli", "ASING NET \\(JML\\)", "CHG RENTANG", "(ada) Tj"]) expect(pdf).toContain(s);
  });
  it("tanpa data -> tetap PDF valid 1 halaman dengan 'belum diambil'", () => {
    const pdf = rekapPdf(makeReport({ fb: null, fs: null, inst: null }, EMPTY, { mode: "latest" }, "2026-11-13"), 0);
    checkXref(pdf);
    expect(pdf).toContain("/Count 1");
    expect(pdf).toContain("belum diambil");
  });
});
