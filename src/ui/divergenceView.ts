/** Tab DIVERGENCE: daftar emiten dengan Hidden Bullish / Bullish / Hidden Bearish / Bearish divergence (dari Chartbit Table view). */
import type { ChartStore } from "../core/chartStore";
import { analyzeSymbol, DIV_TYPES, type DivCfg, type DivSignal, type DivType } from "../core/divergence";
import { fmtDay } from "../core/rekapRange";
import { esc, fmtNum } from "./views";
import { chartbitUrl, scanProgress } from "../core/scanList";

const CLS: Record<DivType, string> = { BULLISH: "b-green", "HIDDEN BULLISH": "b-green", BEARISH: "b-red", "HIDDEN BEARISH": "b-red" };
const WIB = 7 * 3600e3;
const stamp = (ts: number) => new Date(ts + WIB).toISOString().slice(5, 16).replace("T", " ");
const day = (t: string) => (t.length > 10 ? `${fmtDay(t.slice(0, 10))} ${t.slice(11)}` : fmtDay(t));

/** Blok DAFTAR PINDAI (semi-manual): progres hari bursa terakhir + tautan ke emiten berikutnya. */
function scanBlock(charts: ChartStore[], scanList: string[], tradingDay: string): string {
  const p = scanProgress(scanList, charts, tradingDay);
  const link = (code: string, cls: string) => `<a class="badge ${cls}" href="${esc(chartbitUrl(code))}" target="_blank" rel="noopener">${esc(code)}</a>`;
  const head = `<h4 class="sec">DAFTAR PINDAI <span class="small">${scanList.length ? `(${p.done.length}/${scanList.length} terpindai untuk ${esc(fmtDay(tradingDay))})` : "(kosong)"}</span></h4>`;
  const form = `<div class="row scan-form">
      <textarea class="scan-list" rows="2" placeholder="Kode dipisah spasi/koma, mis. BBCA BBRI MEDC PGAS">${esc(scanList.join(" "))}</textarea></div>
    <div class="row" style="margin-top:4px"><button data-scan="save">SIMPAN DAFTAR</button><button data-scan="watch">PAKAI WATCHLIST</button><button data-scan="clear">KOSONGKAN</button></div>`;
  const how = `<div class="small muted">Cara: buka Chartbit emiten pertama → klik kanan grafik → <b>Table view</b> (sekali saja), lalu ketik kode berikutnya
    langsung di grafik + Enter. Radar menangkap tiap emiten ±4 dtk; pasang indikator <b>RSI 14</b> di Chartbit agar nilainya sama dengan grafik.</div>`;
  if (!scanList.length) return head + form + how;
  return `${head}${form}
    <div style="margin-top:6px">${p.next ? `<b>Berikutnya:</b> ${link(p.next, "b-orange")} ` : '<span class="up"><b>Semua emiten di daftar sudah terpindai.</b></span> '}
      ${p.todo.length > 1 ? `<span class="small muted">belum:</span> ${p.todo.slice(1).map((t) => link(t.code, "b-grey")).join(" ")}` : ""}</div>
    ${p.done.length ? `<div style="margin-top:4px"><span class="small muted">sudah:</span> ${p.done.map((c) => `<span class="badge b-green">${esc(c)}</span>`).join(" ")}</div>` : ""}
    ${how}`;
}

export function divergenceView(charts: ChartStore[], cfg: DivCfg, watch: ReadonlySet<string>, scanList: string[] = [], tradingDay = ""): string {
  const help = `<div class="small muted">Sumber: Chartbit (stockbit.com/symbol/KODE/chartbit) → klik kanan grafik → <b>Table view</b>.
    Ganti simbol di Chartbit untuk menambah emiten; gulir tabel untuk menambah candle lama. Osilator: ${esc(cfg.oscillator === "auto" ? "otomatis (RSI → Stoch RSI %K → MACD → RSI 14 dihitung)" : cfg.oscillator === "RSI" ? "RSI 14 (kolom RSI di Table view; bila tidak ada, dihitung radar dari close)" : cfg.oscillator)};
    pivot kiri ${cfg.left} / kanan ${cfg.right}, jarak ${cfg.minRange}–${cfg.maxRange} candle; "baru" = pivot kedua ≤ ${cfg.maxAgeBars} candle lalu. Ubah di ⚙ Settings → divergence.</div>`;
  const scan = scanBlock(charts, scanList, tradingDay);
  if (!charts.length) return `${scan}${help}<div class="empty">Belum ada emiten. Buka Chartbit dan tampilkan Table view; radar membacanya otomatis.</div>`;

  const res = charts.map((c) => ({ c, a: analyzeSymbol(c.symbol, c.tf, c.bars, cfg) }));
  const sec = (type: DivType) => {
    const rows = res
      .map(({ c, a }) => ({ c, a, s: a.latest[type] }))
      .filter((x): x is typeof x & { s: DivSignal } => !!x.s && x.s.barsAgo <= cfg.maxAgeBars)
      .sort((x, y) => x.s.barsAgo - y.s.barsAgo);
    const body = rows.map(({ c, a, s }) => `<tr><td class="l code" data-code="${esc(c.symbol)}">${esc(c.symbol)}${watch.has(c.symbol) ? '<span class="badge b-blue">W</span>' : ""}</td>
      <td class="l">${esc(c.tf)}</td>
      <td class="l">${esc(day(s.p1.t))} → ${esc(day(s.p2.t))}</td>
      <td>${fmtNum(s.p1.price)} → <b>${fmtNum(s.p2.price)}</b></td>
      <td>${fmtNum(s.p1.osc, 1)} → <b>${fmtNum(s.p2.osc, 1)}</b></td>
      <td>${s.barsAgo}</td><td class="l small">${esc(a.oscLabel)}</td></tr>`).join("");
    return `<h4 class="sec"><span class="badge ${CLS[type]}">${type}</span> <span class="small">(${rows.length} emiten)</span></h4>
      ${rows.length ? `<table><thead><tr><th class="l">KODE</th><th class="l">TF</th><th class="l">PIVOT 1 → PIVOT 2</th><th>HARGA</th><th>OSILATOR</th><th>CANDLE LALU</th><th class="l">INDIKATOR</th></tr></thead><tbody>${body}</tbody></table>` : '<div class="small muted">Tidak ada sinyal baru.</div>'}`;
  };

  const all = res
    .sort((x, y) => y.c.updatedAt - x.c.updatedAt)
    .map(({ c, a }) => {
      const sig = DIV_TYPES.map((t) => a.latest[t]).filter((s): s is DivSignal => !!s)
        .map((s) => `<span class="badge ${CLS[s.type]}${s.barsAgo > cfg.maxAgeBars ? " b-old" : ""}" title="${esc(day(s.p1.t))} → ${esc(day(s.p2.t))}">${s.type} ${s.barsAgo}c</span>`).join(" ");
      return `<tr><td class="l code" data-code="${esc(c.symbol)}">${esc(c.symbol)}</td><td class="l">${esc(c.tf)}</td><td>${a.bars}</td>
        <td class="l">${a.lastT ? esc(day(a.lastT)) : "—"}</td><td class="l small">${esc(a.oscLabel)}</td><td class="l">${sig || '<span class="small muted">—</span>'}</td>
        <td class="small">${stamp(c.updatedAt)}</td></tr>`;
    }).join("");

  return `${scan}${help}
    ${DIV_TYPES.map(sec).join("")}
    <h4 class="sec">SEMUA EMITEN TERCATAT <span class="small">(${charts.length})</span></h4>
    <table><thead><tr><th class="l">KODE</th><th class="l">TF</th><th>CANDLE</th><th class="l">TERAKHIR</th><th class="l">OSILATOR</th><th class="l">SINYAL TERAKHIR (c = candle lalu)</th><th>DIAMBIL</th></tr></thead><tbody>${all}</tbody></table>
    <div class="note">Divergence = selisih arah harga vs osilator, bukan kepastian pembalikan. Sinyal terkonfirmasi ${cfg.right} candle setelah pivot
      (sama seperti TradingView). Hasil bergantung pada osilator & jumlah candle yang tersimpan. Bukan rekomendasi beli/jual.</div>`;
}
