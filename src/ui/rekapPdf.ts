/** Laporan PDF tab REKAP (A4 potret). Dibuat lokal di browser; tidak ada data yang dikirim ke luar. */
import { PdfDoc, wrapText, type Rgb } from "../core/pdf";
import type { ForeignSnap, RekapRow } from "../core/rekap";
import { fmtDay, type RekapReport } from "../core/rekapRange";
import { fmtNum, fmtRp } from "./views";

const C = {
  ink: [27, 39, 51] as Rgb,
  grey: [107, 124, 143] as Rgb,
  line: [220, 226, 232] as Rgb,
  zebra: [244, 247, 250] as Rgb,
  band: [11, 22, 34] as Rgb,
  cyan: [56, 189, 248] as Rgb,
  white: [255, 255, 255] as Rgb,
  green: [26, 158, 85] as Rgb,
  red: [210, 60, 65] as Rgb,
  orange: [196, 127, 0] as Rgb,
  blue: [37, 99, 235] as Rgb,
};
const WIB = 7 * 3600e3;
const wibStamp = (ts: number) => new Date(ts + WIB).toISOString().slice(0, 16).replace("T", " ");
const signColor = (v: number | null) => (v == null || v === 0 ? C.ink : v > 0 ? C.green : C.red);
const pct = (v: number | null) => (v == null ? "-" : `${v > 0 ? "+" : ""}${fmtNum(v, 2)}%`);
const rp = (v: number | null) => (v == null ? "-" : fmtRp(v));
const num = (v: number | null) => (v == null ? "-" : fmtNum(v));

export function rekapPdf(rep: RekapReport, now: number): string {
  const r = rep.rekap;
  const src = rep;
  const isRange = !!rep.from;
  const doc = new PdfDoc();
  const W = doc.width;
  const H = doc.height;
  const M = 40;
  const BOTTOM = 52;
  let p = doc.addPage();
  let y = H;

  const day = isRange ? rep.label.replace(/–/g, "-") : src.fb?.day ?? src.fs?.day ?? src.inst?.day ?? "-";
  const dayLabel = isRange ? `Rentang ${day}` : `Hari bursa ${day}`;
  const header = (first: boolean) => {
    doc.rect(p, 0, H - (first ? 70 : 34), W, first ? 70 : 34, C.band);
    if (first) {
      doc.text(p, M, H - 32, "Radar Bandar IDX - Rekap Penutupan", { size: 17, font: "F2", color: C.white });
      doc.text(p, M, H - 52, `${dayLabel}   •   dibuat ${wibStamp(now)} WIB   •   data dari layar Stockbit`, { size: 9, color: C.cyan });
      y = H - 92;
    } else {
      doc.text(p, M, H - 22, `Radar Bandar IDX - Rekap Penutupan ${day} (lanjutan)`, { size: 9.5, font: "F2", color: C.white });
      y = H - 54;
    }
  };
  const newPage = () => {
    p = doc.addPage();
    header(false);
  };
  const ensure = (h: number) => {
    if (y - h < BOTTOM) newPage();
  };
  const para = (s: string, size: number, color: Rgb, font: "F1" | "F2" = "F1", gap = 3) => {
    for (const ln of wrapText(s, size, W - 2 * M, font)) {
      ensure(size + gap);
      y -= size + gap;
      doc.text(p, M, y, ln, { size, color, font });
    }
  };

  header(true);

  // Sumber data
  doc.text(p, M, y, "SUMBER DATA", { size: 9, font: "F2", color: C.ink });
  y -= 4;
  const srcLine = (label: string, ok: boolean, detail: string) =>
    para(`${ok ? "[v]" : "[ ]"} ${label}: ${ok ? detail : "belum diambil"}`, 8.5, ok ? C.ink : C.orange);
  const fDetail = (s: ForeignSnap | null) => (s ? `${s.rows.length} emiten (Movers Stockbit), hari bursa ${s.day}, diambil ${wibStamp(s.capturedAt)} WIB` : "");
  const i = src.inst;
  const instLine = i ? `broker ${i.brokers.map((b) => b.code).join(", ")} (Broker Analysis, net gabungan), ${(isRange ? rep.instSource : i.dateText) ?? "?"}, ${[i.metric, i.investor, i.board].filter(Boolean).join(" / ")}${isRange ? "" : `, diambil ${wibStamp(i.capturedAt)} WIB`}` : "";
  if (isRange) {
    const fn = (rep.fb?.rows.length ?? 0) + (rep.fs?.rows.length ?? 0);
    srcLine("Asing", !!(rep.fb || rep.fs), `${fn} emiten, jumlah net harian dari Movers Stockbit (${rep.coverage.filter((c) => c.fb || c.fs).length}/${rep.coverage.length} hari bursa tersimpan)`);
    srcLine("Institusi", !!i, instLine);
  } else {
    srcLine("Asing beli", !!src.fb, fDetail(src.fb));
    srcLine("Asing jual", !!src.fs, fDetail(src.fs));
    srcLine("Institusi", !!i, instLine);
  }
  for (const w of r.warnings.filter((x) => !/belum diambil/.test(x))) para(`! ${w}`, 8.5, C.orange);
  y -= 8;

  // Ringkasan jumlah
  const counts: [string, number, Rgb][] = [
    ["Sama-sama beli", r.bothBuy.length, C.green], ["Sama-sama jual", r.bothSell.length, C.red],
    ["Berlawanan", r.divergent.length, C.orange], ["Asing saja", r.foreignOnlyBuy.length + r.foreignOnlySell.length, C.blue],
    ["Institusi saja", r.instOnlyBuy.length + r.instOnlySell.length, C.blue],
  ];
  ensure(34);
  const boxW = (W - 2 * M - 4 * 6) / 5;
  counts.forEach(([label, v, col], k) => {
    const x = M + k * (boxW + 6);
    doc.rect(p, x, y - 30, boxW, 30, C.zebra);
    doc.rect(p, x, y - 30, 3, 30, col);
    doc.text(p, x + 9, y - 13, String(v), { size: 12, font: "F2", color: col });
    doc.text(p, x + 9, y - 24, label, { size: 7.5, color: C.grey });
  });
  y -= 40;

  // Total net beli / jual (asing & institusi)
  const tt = rep.totals;
  const totals: [string, number, Rgb][] = [
    ["Asing total net beli", tt.foreignBuy, C.green], ["Asing total net jual", tt.foreignSell, C.red],
    ["Institusi total net beli", tt.instBuy, C.green], ["Institusi total net jual", tt.instSell, C.red],
  ];
  ensure(34);
  const tW = (W - 2 * M - 3 * 6) / 4;
  totals.forEach(([label, v, col], k) => {
    const x = M + k * (tW + 6);
    doc.rect(p, x, y - 30, tW, 30, C.zebra);
    doc.rect(p, x, y - 30, 3, 30, col);
    doc.text(p, x + 9, y - 13, fmtRp(v, false), { size: 12, font: "F2", color: col });
    doc.text(p, x + 9, y - 24, label, { size: 7.5, color: C.grey });
  });
  y -= 40;
  para("Total = jumlah net emiten yang net beli / net jual (hanya emiten yang ada di daftar Stockbit).", 7.5, C.grey);
  y -= 6;

  // Ketersediaan data per hari (mode rentang)
  if (isRange && rep.coverage.length) {
    ensure(30);
    y -= 12;
    doc.text(p, M, y, "KETERSEDIAAN DATA PER HARI BURSA", { size: 9, font: "F2", color: C.ink });
    y -= 12;
    const cx = [M + 4, 200, 280, 380];
    ["HARI", "ASING BELI", "ASING JUAL", "INSTITUSI (harian)"].forEach((h, k) => doc.text(p, cx[k]!, y, h, { size: 7.5, font: "F2", color: C.grey }));
    for (const c of rep.coverage) {
      ensure(11);
      y -= 11;
      doc.text(p, cx[0]!, y, fmtDay(c.day), { size: 8, color: C.ink });
      [c.fb, c.fs, c.inst].forEach((b, k) => doc.text(p, cx[k + 1]!, y, b ? "ada" : "-", { size: 8, color: b ? C.green : C.grey }));
    }
    y -= 8;
  }

  // Tabel
  const COLS = { code: M + 4, foreign: 215, inst: 305, avg: 385, price: 465, chg: W - M - 4 };
  const tableHead = (cols: { foreign: boolean; inst: boolean }) => {
    y -= 12;
    doc.text(p, COLS.code, y, "KODE", { size: 7.5, font: "F2", color: C.grey });
    if (cols.foreign) doc.text(p, COLS.foreign, y, isRange ? "ASING NET (JML)" : "ASING NET", { size: 7.5, font: "F2", color: C.grey, align: "right" });
    if (cols.inst) {
      doc.text(p, COLS.inst, y, isRange ? "INST NET (JML)" : "INST NET", { size: 7.5, font: "F2", color: C.grey, align: "right" });
      doc.text(p, COLS.avg, y, "AVG INST", { size: 7.5, font: "F2", color: C.grey, align: "right" });
    }
    doc.text(p, COLS.price, y, isRange ? "HARGA AKHIR" : "HARGA", { size: 7.5, font: "F2", color: C.grey, align: "right" });
    doc.text(p, COLS.chg, y, isRange ? "CHG RENTANG" : "CHG", { size: 7.5, font: "F2", color: C.grey, align: "right" });
    y -= 4;
    doc.line(p, M, y, W - M, y, C.line, 0.7);
  };
  const section = (title: string, rows: RekapRow[], color: Rgb, cols: { foreign: boolean; inst: boolean }) => {
    if (!rows.length) return;
    ensure(48);
    y -= 8;
    doc.rect(p, M, y - 4, 3, 14, color);
    doc.text(p, M + 8, y, `${title} (${rows.length})`, { size: 10.5, font: "F2", color });
    tableHead(cols);
    rows.forEach((row, k) => {
      if (y - 13 < BOTTOM) {
        newPage();
        doc.text(p, M, y, `${title} (lanjutan)`, { size: 9, font: "F2", color });
        tableHead(cols);
      }
      y -= 13;
      if (k % 2 === 0) doc.rect(p, M, y - 3.5, W - 2 * M, 13, C.zebra);
      doc.text(p, COLS.code, y, row.code, { size: 8.5, font: "F2", color: C.ink });
      if (cols.foreign) doc.text(p, COLS.foreign, y, rp(row.foreign), { size: 8.5, color: signColor(row.foreign), align: "right" });
      if (cols.inst) {
        doc.text(p, COLS.inst, y, rp(row.inst), { size: 8.5, color: signColor(row.inst), align: "right" });
        doc.text(p, COLS.avg, y, num(row.instAvg), { size: 8.5, color: C.ink, align: "right" });
      }
      doc.text(p, COLS.price, y, num(row.price), { size: 8.5, color: C.ink, align: "right" });
      doc.text(p, COLS.chg, y, pct(row.chgPct), { size: 8.5, color: signColor(row.chgPct), align: "right" });
    });
    y -= 10;
  };
  // DAFTAR TOTAL INSTITUSI NET BELI / NET JUAL (gabungan semua kelompok, urut nilai)
  const rankSection = (buy: boolean) => {
    const k = rep.instRank;
    const rows = buy ? k.buy : k.sell;
    if (!src.inst) return;
    const color = buy ? C.green : C.red;
    const total = buy ? tt.instBuy : tt.instSell;
    const hari = k.dataDays !== null && isRange;
    const title = `DAFTAR TOTAL INSTITUSI NET ${buy ? "BELI" : "JUAL"}`;
    const RX = { rank: M + 4, code: M + 24, inst: 160, share: 205, avg: 260, days: 305, fx: 395, price: 470, chg: W - M - 4 };
    const g = { size: 7.5, font: "F2" as const, color: C.grey, align: "right" as const };
    const head = () => {
      y -= 12;
      doc.text(p, RX.rank, y, "#", { size: 7.5, font: "F2", color: C.grey });
      doc.text(p, RX.code, y, "KODE", { size: 7.5, font: "F2", color: C.grey });
      doc.text(p, RX.inst, y, isRange ? "INST NET (JML)" : "INST NET", g);
      doc.text(p, RX.share, y, "PORSI", g);
      doc.text(p, RX.avg, y, "AVG INST", g);
      if (hari) doc.text(p, RX.days, y, buy ? "HARI BELI" : "HARI JUAL", g);
      doc.text(p, RX.fx, y, "ASING NET", g);
      doc.text(p, RX.price, y, isRange ? "HARGA AKHIR" : "HARGA", g);
      doc.text(p, RX.chg, y, isRange ? "CHG RENTANG" : "CHG", g);
      y -= 4;
      doc.line(p, M, y, W - M, y, C.line, 0.7);
    };
    ensure(60);
    y -= 8;
    doc.rect(p, M, y - 4, 3, 14, color);
    doc.text(p, M + 8, y, `${title} (${rows.length} emiten, total ${fmtRp(buy ? total : -total, false)})`, { size: 10.5, font: "F2", color });
    if (!rows.length) {
      y -= 4;
      para("Tidak ada emiten.", 8.5, C.grey);
      y -= 6;
      return;
    }
    head();
    rows.forEach((row, n) => {
      if (y - 13 < BOTTOM) {
        newPage();
        doc.text(p, M, y, `${title} (lanjutan)`, { size: 9, font: "F2", color });
        head();
      }
      y -= 13;
      if (n % 2 === 0) doc.rect(p, M, y - 3.5, W - 2 * M, 13, C.zebra);
      const t = { size: 8.5, align: "right" as const };
      doc.text(p, RX.rank, y, String(row.rank), { size: 8.5, color: C.grey });
      doc.text(p, RX.code, y, row.code, { size: 8.5, font: "F2", color: C.ink });
      doc.text(p, RX.inst, y, rp(row.inst), { ...t, font: "F2", color });
      doc.text(p, RX.share, y, `${fmtNum(row.share * 100, 1)}%`, { ...t, color: C.ink });
      doc.text(p, RX.avg, y, num(row.avg), { ...t, color: C.ink });
      if (hari) doc.text(p, RX.days, y, `${row.days}/${k.dataDays}`, { ...t, color: C.ink });
      doc.text(p, RX.fx, y, rp(row.foreign), { ...t, color: signColor(row.foreign) });
      doc.text(p, RX.price, y, num(row.price), { ...t, color: C.ink });
      doc.text(p, RX.chg, y, pct(row.chgPct), { ...t, color: signColor(row.chgPct) });
    });
    ensure(16);
    y -= 14;
    doc.line(p, M, y + 10, W - M, y + 10, C.line, 0.7);
    doc.text(p, RX.code, y, "TOTAL", { size: 8.5, font: "F2", color: C.ink });
    doc.text(p, RX.inst, y, fmtRp(buy ? total : -total), { size: 8.5, font: "F2", color, align: "right" });
    doc.text(p, RX.share, y, "100%", { size: 8.5, color: C.ink, align: "right" });
    y -= 12;
  };
  rankSection(true);
  rankSection(false);

  // DETEKSI INSTITUSI BELI (pola lot besar live)
  {
    const title = "DETEKSI INSTITUSI BELI - pola lot besar live";
    const multi = rep.liveDayCount > 1;
    const LX = { code: M + 4, buy: 150, sell: 225, net: 300, runs: 345, days: 380, asing: 445, ba: W - M - 4 };
    const head = () => {
      y -= 12;
      const g = { size: 7.5, font: "F2" as const, color: C.grey, align: "right" as const };
      doc.text(p, LX.code, y, "KODE", { size: 7.5, font: "F2", color: C.grey });
      doc.text(p, LX.buy, y, "INST BELI", g);
      doc.text(p, LX.sell, y, "INST JUAL", g);
      doc.text(p, LX.net, y, "NET INST", g);
      doc.text(p, LX.runs, y, "RANGK.", g);
      if (multi) doc.text(p, LX.days, y, "HARI", g);
      doc.text(p, LX.asing, y, "ASING BELI POLA", g);
      doc.text(p, LX.ba, y, "BROKER ANALYSIS", g);
      y -= 4;
      doc.line(p, M, y, W - M, y, C.line, 0.7);
    };
    ensure(60);
    y -= 8;
    doc.rect(p, M, y - 4, 3, 14, C.green);
    doc.text(p, M + 8, y, `${title} (${rep.liveInst.length})`, { size: 10.5, font: "F2", color: C.green });
    y -= 4;
    para(`Data pola ${rep.liveDays}/${rep.liveDayCount} hari bursa. Rangkaian >=3 trade (tiap >=Rp100 jt) emiten & sisi pemukul sama, jeda <=5 menit, total >=Rp1 M; INSTITUSI/LOKAL bila F Buy/F Sell widget tidak ikut naik >=50%. ESTIMASI: broker tidak tampil saat sesi.`, 7.5, C.grey);
    if (!rep.liveInst.length) para("Belum ada pola beli lot besar INSTITUSI/LOKAL tersimpan untuk pilihan ini.", 8.5, C.orange);
    else {
      head();
      rep.liveInst.slice(0, 40).forEach((row, k) => {
        if (y - 13 < BOTTOM) {
          newPage();
          doc.text(p, M, y, `${title} (lanjutan)`, { size: 9, font: "F2", color: C.green });
          head();
        }
        y -= 13;
        if (k % 2 === 0) doc.rect(p, M, y - 3.5, W - 2 * M, 13, C.zebra);
        const t = { size: 8.5, align: "right" as const };
        doc.text(p, LX.code, y, row.code, { size: 8.5, font: "F2", color: C.ink });
        doc.text(p, LX.buy, y, fmtRp(row.instBuy), { ...t, color: C.green });
        doc.text(p, LX.sell, y, row.instSell ? fmtRp(-row.instSell) : "-", { ...t, color: row.instSell ? C.red : C.grey });
        doc.text(p, LX.net, y, fmtRp(row.net), { ...t, font: "F2", color: C.green });
        doc.text(p, LX.runs, y, String(row.instRuns), { ...t, color: C.ink });
        if (multi) doc.text(p, LX.days, y, String(row.days), { ...t, color: C.ink });
        doc.text(p, LX.asing, y, row.asingBuy ? fmtRp(row.asingBuy) : "-", { ...t, color: C.ink });
        const baTxt = row.ba == null ? "tidak di daftar" : `${row.ba > 0 ? "searah" : "berlawanan"} ${fmtRp(row.ba)}`;
        doc.text(p, LX.ba, y, baTxt, { ...t, color: row.ba == null ? C.grey : row.ba > 0 ? C.green : C.red });
      });
    }
    if (rep.liveUnknown.length) {
      y -= 4;
      para(`Beli lot besar pada emiten tanpa widget orderbook (asing/institusi tak bisa dibedakan): ${rep.liveUnknown.slice(0, 15).map((x) => `${x.code} ${fmtRp(x.unkBuy - x.unkSell)}`).join(", ")}${rep.liveUnknown.length > 15 ? ", ..." : ""}.`, 7.5, C.grey);
    }
    y -= 10;
  }

  const both = { foreign: true, inst: true };
  section("ASING & INSTITUSI SAMA-SAMA BELI", r.bothBuy, C.green, both);
  section("ASING & INSTITUSI SAMA-SAMA JUAL", r.bothSell, C.red, both);
  section("BERLAWANAN ARAH", r.divergent, C.orange, both);
  section("ASING BELI (institusi tidak di daftar)", r.foreignOnlyBuy, C.blue, { foreign: true, inst: false });
  section("ASING JUAL (institusi tidak di daftar)", r.foreignOnlySell, C.blue, { foreign: true, inst: false });
  section("INSTITUSI BELI (asing tidak di daftar)", r.instOnlyBuy, C.blue, { foreign: false, inst: true });
  section("INSTITUSI JUAL (asing tidak di daftar)", r.instOnlySell, C.blue, { foreign: false, inst: true });

  // Catatan metode
  ensure(60);
  y -= 6;
  doc.text(p, M, y, "CATATAN", { size: 9, font: "F2", color: C.ink });
  y -= 2;
  for (const s of [
    "Asing = data investor asing Stockbit (panel Movers, Net Foreign Buy/Sell, top 50 per sisi). Institusi = net GABUNGAN broker yang dipilih di Broker Analysis (top 20 per sisi); ini ESTIMASI karena broker juga melayani nasabah non-institusi.",
    "AVG INST = harga rata-rata net beli/jual broker terpilih. Emiten di luar daftar belum tentu tanpa aliran. Data satu hari belum tentu berlanjut; konfirmasi dengan orderbook dan running trade saat pembukaan.",
    "B = miliar, M = juta (format Stockbit). Laporan ini alat bantu membaca arus order, BUKAN rekomendasi beli/jual.",
  ]) para(s, 8, C.grey);

  // Kaki halaman
  const total = doc.pages.length;
  doc.pages.forEach((_, k) => {
    doc.line(k, M, 36, W - M, 36, C.line, 0.5);
    doc.text(k, M, 24, "Radar Bandar IDX  •  hanya membaca layar Stockbit Anda  •  Bukan rekomendasi beli/jual", { size: 7.5, color: C.grey });
    doc.text(k, W - M, 24, `hal ${k + 1}/${total}`, { size: 7.5, color: C.grey, align: "right" });
  });
  return doc.build(`Rekap Penutupan ${day}`);
}
