/**
 * Penulis PDF mini tanpa library (PDF 1.4, font standar Helvetica / Helvetica-Bold, WinAnsiEncoding).
 * Cukup untuk laporan teks + tabel: teks, garis, kotak berwarna. Semua dibuat di browser, tanpa jaringan.
 * Hasil berupa "binary string" (1 karakter = 1 byte); ubah ke Uint8Array dengan toBytes().
 */

export type Rgb = [number, number, number];
export type FontKey = "F1" | "F2";

// Lebar glyph Helvetica / Helvetica-Bold (AFM standar, satuan 1/1000 em) untuk karakter 32..126.
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

/** Karakter Unicode -> byte WinAnsi. Yang tidak ada jadi "?". */
const WIN_ANSI: Record<string, number> = { "•": 0x95, "–": 0x96, "—": 0x97, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "€": 0x80, "™": 0x99 };
export function toWinAnsi(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255)) out += ch;
    else if (WIN_ANSI[ch] !== undefined) out += String.fromCharCode(WIN_ANSI[ch]!);
    else if (ch === "\n" || ch === "\t") out += " ";
    else out += "?";
  }
  return out;
}

export function textWidth(s: string, size: number, font: FontKey = "F1"): number {
  const tbl = font === "F2" ? W_BOLD : W_REG;
  let w = 0;
  for (const ch of toWinAnsi(s)) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c <= 126 ? tbl[c - 32]! : c === 0x95 ? 350 : c === 0x97 ? 1000 : 556;
  }
  return (w * size) / 1000;
}

/** Pecah teks jadi baris yang muat dalam lebar tertentu. */
export function wrapText(s: string, size: number, maxWidth: number, font: FontKey = "F1"): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (textWidth(next, size, font) <= maxWidth || !cur) cur = next;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

const esc = (s: string) => toWinAnsi(s).replace(/[\\()]/g, (c) => `\\${c}`);
const n = (x: number) => (Math.round(x * 100) / 100).toString();
const rgb = (c: Rgb) => c.map((v) => n(v / 255)).join(" ");

export class PdfDoc {
  readonly pages: string[][] = [];
  constructor(readonly width = 595.28, readonly height = 841.89) {}

  addPage(): number {
    this.pages.push([]);
    return this.pages.length - 1;
  }
  private ops(p: number) {
    return this.pages[p]!;
  }

  /** Teks; y = baseline dari BAWAH halaman (koordinat PDF). align "right" = x adalah tepi kanan. */
  text(p: number, x: number, y: number, s: string, opt: { size?: number; font?: FontKey; color?: Rgb; align?: "left" | "right" | "center" } = {}): void {
    const size = opt.size ?? 9;
    const font = opt.font ?? "F1";
    const w = opt.align && opt.align !== "left" ? textWidth(s, size, font) : 0;
    const x0 = opt.align === "right" ? x - w : opt.align === "center" ? x - w / 2 : x;
    this.ops(p).push(`BT /${font} ${n(size)} Tf ${rgb(opt.color ?? [0, 0, 0])} rg ${n(x0)} ${n(y)} Td (${esc(s)}) Tj ET`);
  }
  line(p: number, x1: number, y1: number, x2: number, y2: number, color: Rgb = [200, 200, 200], width = 0.5): void {
    this.ops(p).push(`${rgb(color)} RG ${n(width)} w ${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`);
  }
  rect(p: number, x: number, y: number, w: number, h: number, fill: Rgb): void {
    this.ops(p).push(`${rgb(fill)} rg ${n(x)} ${n(y)} ${n(w)} ${n(h)} re f`);
  }

  /** Susun file PDF utuh (binary string). */
  build(title = "Laporan"): string {
    const objs: string[] = [];
    const add = (body: string) => objs.push(body) ;
    const pageCount = this.pages.length || 1;
    if (!this.pages.length) this.addPage();
    // 1 catalog, 2 pages, 3 F1, 4 F2, 5 info, lalu (page, content) per halaman
    const firstPage = 6;
    const kids = this.pages.map((_, i) => `${firstPage + i * 2} 0 R`).join(" ");
    add(`<< /Type /Catalog /Pages 2 0 R >>`);
    add(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
    add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
    add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);
    add(`<< /Title (${esc(title)}) /Producer (Radar Bandar IDX) >>`);
    this.pages.forEach((ops, i) => {
      const stream = ops.join("\n");
      add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(this.width)} ${n(this.height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${firstPage + i * 2 + 1} 0 R >>`);
      add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    });
    let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets: number[] = [];
    objs.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return out;
  }
}

export function toBytes(binary: string): Uint8Array {
  const b = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) b[i] = binary.charCodeAt(i) & 0xff;
  return b;
}
