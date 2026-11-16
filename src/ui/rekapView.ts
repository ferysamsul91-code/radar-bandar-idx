/**
 * Tab REKAP: arus asing seluruh pasar vs net broker institusi pilihan.
 * Bisa "Terbaru" (pengambilan terakhir) atau per rentang tanggal (riwayat per hari bursa).
 */
import type { ForeignSnap, InstSnap, RekapRow } from "../core/rekap";
import { completeness, fmtDay, makeReport, shiftTradingDays, type RangeSel, type RekapHistory, type RekapReport } from "../core/rekapRange";
import type { RekapSources } from "./Panel";
import type { AutoRekapCfg } from "../core/autoRekap";
import { esc, fmtNum, fmtRp } from "./views";

const WIB = 7 * 3600e3;
const hhmm = (ts: number) => new Date(ts + WIB).toISOString().slice(11, 16);
const wibDate = (ts: number) => new Date(ts + WIB).toISOString().slice(0, 10);
/** Data dianggap final bila diambil setelah 16:15 WIB pada hari bursanya, atau sesudah hari itu. */
export const isFinal = (day: string | null, capturedAt: number) =>
  !day || day.includes("..") || wibDate(capturedAt) > day || (wibDate(capturedAt) === day && hhmm(capturedAt) >= "16:15");
const sgn = (n: number | null) => (n == null ? "" : n > 0 ? "up" : n < 0 ? "down" : "");

function srcLine(label: string, ok: boolean, detail: string, how: string): string {
  return `<div class="small">${ok ? "✅" : "⬜"} <b>${label}</b>: ${ok ? detail : `<span class="warn">${how}</span>`}</div>`;
}
function foreignDetail(s: ForeignSnap | null): string {
  if (!s) return "";
  const fin = isFinal(s.day, s.capturedAt) ? "" : ' <span class="warn">(sesi berjalan, belum final)</span>';
  return `${s.rows.length} emiten • hari bursa ${s.day} • diambil ${hhmm(s.capturedAt)} WIB${fin}`;
}
function instDetail(s: InstSnap | null, source: string): string {
  if (!s) return "";
  const fin = isFinal(s.day, s.capturedAt) ? "" : ' <span class="warn">(sesi berjalan, belum final)</span>';
  const brokers = s.brokers.map((b) => `<span class="badge ${b.type === "foreign" ? "b-red" : b.type === "bumn" ? "b-green" : "b-blue"}">${esc(b.code)}</span>`).join("");
  return `${brokers} • ${esc(source || s.dateText || "?")} • ${esc([s.metric, s.investor, s.board].filter(Boolean).join(" / "))} • ${s.buys.length}+${s.sells.length} emiten${fin}`;
}

function table(title: string, rows: RekapRow[], cols: { foreign: boolean; inst: boolean }, range: boolean): string {
  if (!rows.length) return "";
  const head = `<th class="l">KODE</th>${cols.foreign ? `<th>ASING NET${range ? " Σ" : ""}</th>` : ""}${cols.inst ? `<th>INST NET${range ? " Σ" : ""}</th><th>AVG INST</th>` : ""}<th>${range ? "HARGA AKHIR" : "HARGA"}</th><th>${range ? "CHG RENTANG" : "CHG"}</th>`;
  const body = rows.slice(0, 40).map((r) => `<tr><td class="l code" data-code="${esc(r.code)}">${esc(r.code)}</td>
    ${cols.foreign ? `<td class="${sgn(r.foreign)}">${fmtRp(r.foreign)}</td>` : ""}
    ${cols.inst ? `<td class="${sgn(r.inst)}">${fmtRp(r.inst)}</td><td>${fmtNum(r.instAvg)}</td>` : ""}
    <td>${fmtNum(r.price)}</td><td class="${sgn(r.chgPct)}">${r.chgPct == null ? "—" : `${r.chgPct > 0 ? "+" : ""}${fmtNum(r.chgPct, 2)}%`}</td></tr>`).join("");
  return `<h4 class="sec">${title} <span class="small">(${rows.length})</span></h4>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function rangeBar(sel: RangeSel, today: string, rep: RekapReport, hist: RekapHistory): string {
  const btn = (mode: string, label: string) => `<button data-rr="${mode}" class="${sel.mode === mode ? "on" : ""}">${label}</button>`;
  const from = rep.from ?? sel.from ?? (today ? shiftTradingDays(today, -5) : "");
  const to = rep.to ?? sel.to ?? today;
  const ranges = Object.entries(hist.inst)
    .map(([k, s]) => ({ k, from: k.split("_")[0]!, to: k.split("_")[1]!, s }))
    .filter((x) => x.from !== x.to)
    .sort((a, b) => b.s.capturedAt - a.s.capturedAt)
    .slice(0, 6);
  return `<div class="rr">
    <div class="row">${btn("latest", "TERBARU")}${btn("today", "HARI INI")}${btn("5d", "S/D 5 HARI BURSA LALU")}${btn("custom", "RENTANG")}</div>
    <div class="row" style="margin-top:6px"><span class="small muted">Sumber institusi:</span>
      <button data-rr-src="ba" class="${sel.instSrc !== "trace" ? "on" : ""}">BROKER ANALYSIS</button>
      <button data-rr-src="trace" class="${sel.instSrc === "trace" ? "on" : ""}">JEJAK RUNNING TRADE</button></div>
    ${sel.mode === "custom" ? `<div class="row" style="margin-top:6px">
      <input type="date" class="rr-from" value="${esc(from)}"> s/d <input type="date" class="rr-to" value="${esc(to)}">
      <button data-rr="apply">TERAPKAN</button></div>` : ""}
    ${ranges.length ? `<div class="small" style="margin-top:6px">Rentang institusi tersimpan dari Broker Analysis:
      ${ranges.map((x) => `<button data-rr="use" data-from="${x.from}" data-to="${x.to}">${esc(fmtDay(x.from))} – ${esc(fmtDay(x.to))}</button>`).join(" ")}</div>` : ""}
  </div>`;
}

function totalsBlock(rep: RekapReport): string {
  const t = rep.totals;
  const box = (label: string, v: number, cls: string) => `<div class="tot"><div class="small">${label}</div><div class="${cls}"><b>${fmtRp(v, false)}</b></div></div>`;
  return `<div class="tots">
    ${box("ASING TOTAL NET BELI", t.foreignBuy, "up")}${box("ASING TOTAL NET JUAL", t.foreignSell, "down")}
    ${box("INSTITUSI TOTAL NET BELI", t.instBuy, "up")}${box("INSTITUSI TOTAL NET JUAL", t.instSell, "down")}
  </div><div class="small muted">Total = jumlah net emiten yang net beli / net jual dalam ${rep.from ? "rentang" : "data"} ini (hanya emiten yang ada di daftar Stockbit).</div>`;
}

function coverageBlock(rep: RekapReport): string {
  if (!rep.coverage.length) return "";
  const mark = (b: boolean) => (b ? '<span class="up">✓</span>' : '<span class="muted">–</span>');
  return `<details class="cov" data-key="cov"><summary class="small">Ketersediaan data per hari (${rep.coverage.filter((c) => c.fb || c.fs).length}/${rep.coverage.length} hari ada data asing)</summary>
    <table><thead><tr><th class="l">HARI BURSA</th><th>ASING BELI</th><th>ASING JUAL</th><th>INSTITUSI BA (harian)</th><th>JEJAK RT</th></tr></thead><tbody>
    ${rep.coverage.map((c) => `<tr><td class="l">${esc(fmtDay(c.day))}</td><td>${mark(c.fb)}</td><td>${mark(c.fs)}</td><td>${mark(c.inst)}</td><td>${mark(c.trace)}</td></tr>`).join("")}
    </tbody></table></details>`;
}

/** DAFTAR TOTAL INSTITUSI: semua emiten net beli (atau net jual) institusi dari semua kelompok, urut nilai. */
function instRankBlock(rep: RekapReport, side: "buy" | "sell"): string {
  const k = rep.instRank;
  const rows = side === "buy" ? k.buy : k.sell;
  const buy = side === "buy";
  const total = buy ? rep.totals.instBuy : rep.totals.instSell;
  const range = !!rep.from;
  const hari = k.dataDays !== null && range;
  const fx = (v: number | null) =>
    v == null ? '<span class="muted">—</span>' : `<span class="${sgn(v)}">${fmtRp(v)}</span>${(v > 0) === buy ? ' <span class="small up">searah</span>' : ' <span class="small down">lawan</span>'}`;
  const title = buy ? "📋 DAFTAR TOTAL INSTITUSI NET BELI" : "📋 DAFTAR TOTAL INSTITUSI NET JUAL";
  if (!rows.length) return `<h4 class="sec">${title} <span class="small">(0)</span></h4><div class="small muted">Belum ada data institusi untuk pilihan ini.</div>`;
  const body = rows.map((r) => `<tr><td>${r.rank}</td><td class="l code" data-code="${esc(r.code)}">${esc(r.code)}</td>
    <td class="${sgn(r.inst)}"><b>${fmtRp(r.inst)}</b></td><td>${fmtNum(r.share * 100, 1)}%</td><td>${fmtNum(r.avg)}</td>
    ${hari ? `<td>${r.days}/${k.dataDays}</td>` : ""}<td class="l">${fx(r.foreign)}</td><td>${fmtNum(r.price)}</td>
    <td class="${sgn(r.chgPct)}">${r.chgPct == null ? "—" : `${r.chgPct > 0 ? "+" : ""}${fmtNum(r.chgPct, 2)}%`}</td></tr>`).join("");
  return `<details class="cov rank" data-key="rank-${side}" open><summary><h4 class="sec" style="display:inline">${title}</h4>
      <span class="small">(${rows.length} emiten • total ${fmtRp(buy ? total : -total, false)}${range ? " • Σ rentang" : ""})</span></summary>
    <table><thead><tr><th>#</th><th class="l">KODE</th><th>INST NET${range ? " Σ" : ""}</th><th>PORSI</th><th>AVG INST</th>${hari ? `<th>HARI ${buy ? "BELI" : "JUAL"}</th>` : ""}<th class="l">ASING NET</th>
      <th>${range ? "HARGA AKHIR" : "HARGA"}</th><th>${range ? "CHG RENTANG" : "CHG"}</th></tr></thead><tbody>${body}
      <tr class="tot-row"><td></td><td class="l"><b>TOTAL</b></td><td class="${buy ? "up" : "down"}"><b>${fmtRp(buy ? total : -total)}</b></td><td>100%</td><td colspan="${hari ? 5 : 4}"></td></tr>
    </tbody></table></details>`;
}

/** DETEKSI INSTITUSI BELI: pola lot besar live kategori INSTITUSI/LOKAL, net beli per emiten (ESTIMASI). */
function liveInstBlock(rep: RekapReport): string {
  const range = rep.liveDayCount > 1;
  const cov = `data pola ${rep.liveDays}/${rep.liveDayCount} hari bursa`;
  const ba = (v: number | null) =>
    v == null ? '<span class="muted">tidak di daftar</span>'
      : v > 0 ? `<span class="up">✓ searah ${fmtRp(v)}</span>` : `<span class="down">✗ berlawanan ${fmtRp(v)}</span>`;
  const body = rep.liveInst.slice(0, 40).map((r) => `<tr><td class="l code" data-code="${esc(r.code)}">${esc(r.code)}</td>
    <td class="up">${fmtRp(r.instBuy)}</td><td class="down">${r.instSell ? fmtRp(-r.instSell) : "—"}</td><td class="up"><b>${fmtRp(r.net)}</b></td>
    <td>${r.instRuns}</td>${range ? `<td>${r.days}</td>` : ""}<td>${r.asingBuy ? fmtRp(r.asingBuy) : "—"}</td><td class="l">${ba(r.ba)}</td></tr>`).join("");
  const table = rep.liveInst.length
    ? `<table><thead><tr><th class="l">KODE</th><th>INST BELI</th><th>INST JUAL</th><th>NET INST</th><th>RANGKAIAN</th>${range ? "<th>HARI</th>" : ""}<th>ASING BELI (pola)</th><th class="l">BROKER ANALYSIS</th></tr></thead><tbody>${body}</tbody></table>`
    : `<div class="small muted">Belum ada pola beli lot besar kategori INSTITUSI/LOKAL untuk pilihan ini. Pola dikumpulkan saat jam bursa selama tab
        stockbit.com/orderbook (panel Running Trade + widget orderbook emiten) terbuka, dan disimpan tiap 30 detik.</div>`;
  const unk = rep.liveUnknown.slice(0, 20);
  const unkBlock = unk.length
    ? `<details class="cov" data-key="liveunk"><summary class="small">Beli lot besar pada emiten TANPA widget orderbook (${rep.liveUnknown.length}): asing/institusi tak bisa dibedakan</summary>
      <table><thead><tr><th class="l">KODE</th><th>BELI POLA</th><th>JUAL POLA</th><th>NET</th></tr></thead><tbody>
      ${unk.map((r) => `<tr><td class="l code" data-code="${esc(r.code)}">${esc(r.code)}</td><td class="up">${fmtRp(r.unkBuy)}</td><td class="down">${r.unkSell ? fmtRp(-r.unkSell) : "—"}</td><td class="up">${fmtRp(r.unkBuy - r.unkSell)}</td></tr>`).join("")}
      </tbody></table><div class="small muted">Tambahkan widget orderbook emiten ini agar F Buy/F Sell terbaca dan polanya bisa dikategorikan.</div></details>`
    : "";
  return `<h4 class="sec">🏦 DETEKSI INSTITUSI BELI <span class="small">(pola lot besar live • ${rep.liveInst.length} emiten • ${cov})</span></h4>
    ${table}${unkBlock}
    <div class="note">Pola = rangkaian ≥3 trade (tiap ≥Rp100 jt) emiten & sisi agresor sama, jeda ≤5 menit, total ≥Rp1 M; INSTITUSI/LOKAL bila F Buy/F Sell
      widget tidak ikut naik ≥50% nilai rangkaian. ESTIMASI: BEI menyembunyikan kode broker saat sesi, jadi pola ini bisa juga bandar atau ritel besar lokal.
      Sisi = pemukul (agresor); akumulasi pasif di bid tercatat sebagai jual. "✓ searah" = Broker Analysis (broker pilihan Anda) juga net beli. Bukan rekomendasi beli/jual.</div>`;
}

/** Tabel RIWAYAT TERSIMPAN (30 hari bursa terakhir yang punya data) + tombol cadangan. */
function historyBlock(hist: RekapHistory, today: string, missingToday: string[] | null): string {
  const days = new Set<string>([...Object.keys(hist.fbuy), ...Object.keys(hist.fsell), ...Object.keys(hist.trace ?? {}), ...Object.keys(hist.live ?? {})]);
  for (const k of Object.keys(hist.inst)) {
    const [a, b] = k.split("_");
    if (a && a === b) days.add(a);
  }
  const list = [...days].sort().reverse().slice(0, 30);
  const mark = (b: boolean) => (b ? '<span class="up">✓</span>' : '<span class="muted">–</span>');
  const finalOf = (d: string) => {
    const caps = [hist.fbuy[d]?.capturedAt, hist.fsell[d]?.capturedAt].filter((x): x is number => !!x);
    return caps.length ? caps.every((c) => isFinal(d, c)) : null;
  };
  const rows = list.map((d) => {
    const c = completeness(hist, d);
    const fin = finalOf(d);
    const status = c.missing.length ? `<span class="warn">kurang: ${esc(c.missing.join(", "))}</span>` : `<span class="up">lengkap</span>`;
    return `<tr><td class="l">${esc(fmtDay(d))}</td><td>${mark(c.fb)}</td><td>${mark(c.fs)}</td><td>${mark(c.inst)}</td><td>${mark(c.trace)}</td><td>${mark(!!hist.live?.[d])}</td>
      <td class="l">${status}${fin === false ? ' <span class="small warn">(asing belum final)</span>' : ""}</td></tr>`;
  }).join("");
  const banner = missingToday?.length
    ? `<div class="small warn" style="margin:6px 0">⚠ REKAP ${esc(fmtDay(today))} belum lengkap: ${esc(missingToday.join(", "))}.
        Buka Movers (Net Foreign Buy & Sell) dan Broker Analysis, atau biarkan panel Running Trade terbuka saat bursa (jejak RT).</div>`
    : "";
  return `${banner}<details class="cov" data-key="hist"><summary class="small"><b>RIWAYAT TERSIMPAN</b> (${days.size} hari bursa; disimpan lokal 365 hari)</summary>
    ${list.length ? `<table><thead><tr><th class="l">HARI BURSA</th><th>ASING BELI</th><th>ASING JUAL</th><th>INSTITUSI BA</th><th>JEJAK RT</th><th>POLA LIVE</th><th class="l">STATUS</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="small muted">Belum ada riwayat.</div>'}
    <div class="row" style="margin-top:6px"><button data-bk="export">EXPORT RIWAYAT (JSON)</button> <button data-bk="import">IMPORT RIWAYAT</button>
      <input type="file" accept=".json,application/json" class="bk-file" style="display:none"></div>
    <div class="small muted">Cadangan berisi riwayat REKAP, jejak institusi, Broker Summary & pengaturan. Simpan file-nya bila ingin pindah
      komputer atau sebelum Remove ekstensi (data lokal ikut terhapus saat ekstensi di-Remove).</div></details>`;
}

/** Blok AUTO REKAP: status otomatis + tombol ambil sekarang. */
function autoBlock(auto: { info: string; cfg: AutoRekapCfg } | undefined): string {
  if (!auto) return "";
  const c = auto.cfg;
  const st = c.enabled
    ? `aktif • setelah ${esc(c.afterWIB)} WIB tiap hari bursa (asing + institusi ${esc(c.brokers.join(","))})${c.intradayMin > 0 ? ` • Movers tiap ${c.intradayMin} mnt saat sesi` : ""}`
    : "NONAKTIF (Settings → autoRekap.enabled)";
  return `<div class="row" style="margin:4px 0 6px"><button data-rekap="auto" class="on">⟳ AMBIL REKAP SEKARANG</button>
    <span class="small muted">AUTO REKAP: ${st}. Butuh 1 tab stockbit.com/orderbook terbuka; Stockbit dimuat di latar (iframe tersembunyi), tanpa API.</span></div>
    ${auto.info ? `<div class="small">Terakhir: ${esc(auto.info)}</div>` : ""}`;
}

export function rekapView(latest: RekapSources, hist: RekapHistory, sel: RangeSel, today: string, _now: number, missingToday: string[] | null = null, auto?: { info: string; cfg: AutoRekapCfg }): string {
  const rep = makeReport(latest, hist, sel, today);
  const r = rep.rekap;
  const isRange = !!rep.from;
  const both = { foreign: true, inst: true };
  const hasAny = !!(rep.fb || rep.fs || rep.inst);
  const sources = isRange
    ? `<div class="rekap-src"><div><b>${esc(rep.label)}</b></div>
        ${srcLine("Asing", !!rep.fb, `${rep.fb ? `${rep.fb.rows.length + (rep.fs?.rows.length ?? 0)} emiten • jumlah net harian dari Movers` : ""}`, "belum ada data asing tersimpan untuk rentang ini (buka Movers tiap hari bursa)")}
        ${srcLine("Institusi", !!rep.inst, instDetail(rep.inst, rep.instSource), "pilih rentang yang sama di Broker Analysis (tombol tanggal → Last 7D / kalender), atau ambil data harian")}`
    : `<div class="rekap-src">
        ${srcLine("Asing beli", !!latest.fb, foreignDetail(latest.fb), "buka Movers (ikon api di kanan) → tab Net Foreign Buy")}
        ${srcLine("Asing jual", !!latest.fs, foreignDetail(latest.fs), "buka Movers → tab Net Foreign Sell")}
        ${srcLine("Institusi", !!latest.inst, instDetail(latest.inst, ""), "buka Broker Analysis, pilih broker institusi (mis. AK ZP BK KZ RX), sakelar Net aktif")}`;
  const warn = r.warnings.filter((w) => !/belum diambil/.test(w)).map((w) => `<div class="small warn">⚠ ${esc(w)}</div>`).join("");
  const head = `${autoBlock(auto)}${historyBlock(hist, today, missingToday)}${rangeBar(sel, today, rep, hist)}${sources}${warn}</div>`;
  if (!hasAny && !rep.liveInst.length && !rep.liveUnknown.length)
    return `${head}<div class="empty">Belum ada data REKAP untuk pilihan ini. Buka sumber di atas di Stockbit; radar membacanya otomatis.</div>${liveInstBlock(rep)}`;
  return `${head}
    ${hasAny ? totalsBlock(rep) : ""}
    ${coverageBlock(rep)}
    <div class="row" style="margin:8px 0"><button data-rekap="csv">EXPORT REKAP CSV</button> <button data-rekap="pdf">EXPORT REKAP PDF</button></div>
    ${rep.inst ? `${instRankBlock(rep, "buy")}${instRankBlock(rep, "sell")}` : ""}
    ${liveInstBlock(rep)}
    ${table(`ASING & INSTITUSI SAMA-SAMA BELI`, r.bothBuy, both, isRange)}
    ${table(`ASING & INSTITUSI SAMA-SAMA JUAL`, r.bothSell, both, isRange)}
    ${table("BERLAWANAN ARAH", r.divergent, both, isRange)}
    ${table("ASING BELI (institusi tidak di daftar)", r.foreignOnlyBuy, { foreign: true, inst: false }, isRange)}
    ${table("ASING JUAL (institusi tidak di daftar)", r.foreignOnlySell, { foreign: true, inst: false }, isRange)}
    ${table("INSTITUSI BELI (asing tidak di daftar)", r.instOnlyBuy, { foreign: false, inst: true }, isRange)}
    ${table("INSTITUSI JUAL (asing tidak di daftar)", r.instOnlySell, { foreign: false, inst: true }, isRange)}
    <div class="note">Asing = data investor asing Stockbit (Movers, top 50 per sisi per hari${isRange ? "; rentang = jumlah net harian tersimpan, hari kosong dihitung 0" : ""}).
      ${sel.instSrc === "trace" ? "Institusi = jejak running trade: rangkaian besar broker non-ritel (XL, XC dikecualikan) selama panel Running Trade terbuka: ESTIMASI." : "Institusi = net GABUNGAN broker pilihan Anda di Broker Analysis (top 20 per sisi): ESTIMASI."} Emiten di luar daftar belum tentu
      tanpa aliran. Konfirmasi dengan orderbook & running trade. Bukan rekomendasi beli/jual.</div>`;
}

export const REKAP_CSS = `
.rr .row { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.rr input[type=date] { background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:5px; padding:2px 6px; font:inherit; color-scheme:dark; }
.rekap-src { margin-top:8px; }
.scan-form textarea { width:100%; box-sizing:border-box; background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:5px; padding:4px 6px; font:inherit; }
a.badge { text-decoration:none; cursor:pointer; }
.tots { display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; margin:8px 0 4px; }
.tot { background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:6px 8px; }
.tot b { font-size:14px; }
.cov { margin:6px 0; }
.rank summary { cursor:pointer; margin-top:8px; }
.rank .tot-row td { border-top:1px solid var(--line); }
.cov summary { cursor:pointer; }
`;
