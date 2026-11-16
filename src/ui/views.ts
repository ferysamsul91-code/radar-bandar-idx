/** Render HTML tab-tab panel (string murni, tanpa framework). */
import type { BsSummary } from "../core/brokerSummary";
import type { BigEvent, EmitenView } from "../core/engine";
import type { BookRow, TradeRow } from "./Panel";

export const fmtNum = (n: number | null | undefined, d = 0) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });

export function fmtRp(n: number | null | undefined, signed = true): string {
  if (n == null) return "—";
  const a = Math.abs(n);
  const s = n < 0 ? "-" : signed && n > 0 ? "+" : "";
  const f = (x: number) => x.toLocaleString("id-ID", { maximumFractionDigits: 2 });
  if (a >= 1e12) return `${s}${f(a / 1e12)}T`;
  if (a >= 1e9) return `${s}${f(a / 1e9)}B`;
  if (a >= 1e6) return `${s}${f(a / 1e6)}M`;
  if (a >= 1e3) return `${s}${f(a / 1e3)}K`;
  return `${s}${f(a)}`;
}

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const sgn = (n: number | null | undefined) => (n == null ? "" : n > 0 ? "up" : n < 0 ? "down" : "");
const pctCls = (x: number | null) => (x === null ? "" : x >= 0.6 ? "up" : x <= 0.4 ? "down" : "");
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const STATUS_CLS: Record<string, string> = {
  "FLOW KUAT": "b-green", "PADA BELI": "b-orange", "CUAN MENANTI": "b-blue", "PADA JUALAN": "b-red", NETRAL: "b-grey",
};

function ago(now: number, ts: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  return s < 90 ? `${s}s lalu` : s < 5400 ? `${Math.round(s / 60)} mnt lalu` : `${Math.round(s / 3600)} jam lalu`;
}

function statusNote(v: EmitenView): string {
  const notes: string[] = [];
  if (v.score.grade === "A+" || v.stars > 0) notes.push("PRIORITAS");
  if (v.score.grade) notes.push(v.score.grade);
  if (v.flags.bidDitarik) notes.push("BID DITARIK");
  if (v.flags.refillOffer) notes.push("REFILL OFFER");
  if (v.flags.bidBertahan) notes.push("BID BERTAHAN");
  if (v.status !== "NETRAL") notes.push("CEK ORDERBOOK");
  return notes.join(" • ");
}

function sideCell(v: EmitenView, now: number): string {
  if (v.sidePending) {
    return `<div class="muted">MENUNGGU: PADA ${v.sidePending.to}</div><div class="small">${ago(now, v.sidePending.since)} • big ${v.sidePending.big}</div>`;
  }
  const c = v.sideChange;
  if (!c) return `<div class="muted">—</div><div class="small">${v.qLabel ?? v.rame}</div>`;
  const old = now - c.at > 90_000;
  const txt = `PADA ${c.from} → PADA ${c.to}`;
  return old
    ? `<div class="muted">RIWAYAT: ${txt}</div><div class="small">${ago(now, c.at)}</div>`
    : `<div class="${c.to === "BELI" ? "up" : "down"}">${txt}</div><div class="small">${ago(now, c.at)} • terkonfirmasi</div>`;
}

function codeCell(v: EmitenView, watch: ReadonlySet<string>): string {
  const w = watch.has(v.code) ? `<span class="badge b-blue" title="Watchlist">W</span>` : "";
  const stars = v.stars ? `<span class="badge b-star">★${v.stars}</span>` : "";
  const grade = v.score.grade ? `<span class="badge ${v.score.grade === "A+" ? "b-green" : "b-grey"}">${v.score.grade}</span>` : "";
  const warn = v.warn ? `<span class="badge b-orange" title="Volatilitas intraday > 15%">⚠</span>` : "";
  return `<div><span class="code" data-code="${esc(v.code)}">${esc(v.code)}</span>${w}${stars}${grade}${warn}</div><div class="small">score ${v.score.score}</div>`;
}

function bar(v: EmitenView): string {
  const b = v.m.mid.buyPct;
  if (b === null) return `<div class="small muted">belum ada trade bersisi</div>`;
  const bp = Math.round(b * 100);
  return `<div class="bvj"><span class="up">B ${bp}%</span><span class="down">J ${100 - bp}%</span></div>
    <div class="bar"><i style="width:${bp}%"></i></div><div class="small">${v.qLabel ?? v.rame} • Q ${v.q}</div>`;
}

export function scannerTable(views: EmitenView[], now: number, compact: boolean, empty: string, watch: ReadonlySet<string> = new Set()): string {
  if (!views.length) return `<div class="empty">${empty}</div>`;
  const r = views[0]!.roles;
  const rows = views.slice(0, 60).map((v) => {
    const status = `<span class="badge ${STATUS_CLS[v.status]}">${v.status}</span><div class="small">${statusNote(v)}</div>`;
    if (compact) {
      return `<tr><td class="l">${codeCell(v, watch)}</td><td class="${pctCls(v.m.mid.buyPct)}">${pct(v.m.mid.buyPct)}</td>
        <td class="${sgn(v.m.mid.aggrFlow)}">${fmtRp(v.m.mid.aggrFlow)}</td><td class="l">${status}</td></tr>`;
    }
    return `<tr><td class="l">${codeCell(v, watch)}</td><td>${fmtNum(v.price)}</td>
      <td class="${sgn(v.chgPct)}">${v.chgPct == null ? "—" : `${v.chgPct > 0 ? "+" : ""}${fmtNum(v.chgPct, 2)}%`}</td>
      <td class="${pctCls(v.m.short.buyPct)}">${pct(v.m.short.buyPct)}</td>
      <td class="${pctCls(v.m.mid.buyPct)}">${pct(v.m.mid.buyPct)}</td>
      <td class="${pctCls(v.m.long.buyPct)}">${pct(v.m.long.buyPct)}</td>
      <td class="${sgn(v.m.mid.aggrFlow)}">${fmtRp(v.m.mid.aggrFlow)}</td>
      <td class="l w-bar">${bar(v)}</td><td class="l">${status}</td><td class="l">${sideCell(v, now)}</td></tr>`;
  }).join("");
  const head = compact
    ? `<th class="l">KODE</th><th>${r[1]} BUY</th><th>AGGR FLOW</th><th class="l">STATUS</th>`
    : `<th class="l">KODE</th><th>PRICE</th><th>CHG</th><th>${r[0]} BUY</th><th>${r[1]} BUY</th><th>${r[2]} BUY</th>
       <th>AGGR FLOW</th><th class="l">BELI vs JUAL</th><th class="l">STATUS</th><th class="l">PERGANTIAN SISI</th>`;
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

export function bookTable(rows: BookRow[]): string {
  if (!rows.length) return `<div class="empty">Belum ada widget orderbook terbaca.</div>`;
  const body = rows.map((r) => `<tr class="${r.ok ? "" : "bad"}"><td class="l code" data-code="${esc(r.code)}">${esc(r.code)}</td><td>${fmtNum(r.last)}</td>
    <td>${fmtNum(r.bestBid)}</td><td>${fmtNum(r.bestOffer)}</td>
    <td class="${r.aqi != null && r.aqi > 1.5 ? "up" : ""}">${fmtNum(r.aqi, 2)}</td>
    <td class="${r.depth != null && r.depth >= 0.8 ? "up" : "down"}">${fmtNum(r.depth, 2)}</td>
    <td class="${sgn(r.foreignNet)}">${fmtRp(r.foreignNet)}</td></tr>`).join("");
  return `<table><thead><tr><th class="l">KODE</th><th>LAST</th><th>BID</th><th>OFFER</th><th>AQI</th><th>DEPTH 5</th><th>F NET</th></tr></thead>
    <tbody>${body}</tbody></table>
    <div class="note">Sumber: widget orderbook Stockbit. F NET = F Buy − F Sell (akumulasi hari ini, dari Stockbit). AQI & DEPTH dari level yang tampil.
    DEPTH ≥ 0,8 = DEPTH SEHAT.</div>`;
}

export function lifecycleList(views: EmitenView[], now: number): string {
  const ev = views.flatMap((v) => v.lifecycle.map((e) => ({ ...e, code: v.code }))).sort((a, b) => b.ts - a.ts).slice(0, 15);
  if (!ev.length) return `<div class="note">Belum ada event bid/offer (butuh widget orderbook emiten yang juga muncul di running trade).</div>`;
  const cls = (t: string) => (/DITARIK|REFILL/.test(t) ? "down" : /BERTAHAN|OFFER DIMAKAN/.test(t) ? "up" : "");
  return `<table><thead><tr><th class="l">EVENT</th><th class="l">KODE</th><th>HARGA</th><th>LOT</th><th>KAPAN</th></tr></thead><tbody>${
    ev.map((e) => `<tr><td class="l ${cls(e.type)}">${e.type}${e.type === "REFILL" ? ` ${e.side.toUpperCase()}` : ""}</td>
      <td class="l code" data-code="${esc(e.code)}">${esc(e.code)}</td><td>${fmtNum(e.price)}</td><td>${fmtNum(e.lot)}</td><td>${ago(now, e.ts)}</td></tr>`).join("")
  }</tbody></table>`;
}

export function bigTable(views: EmitenView[], bigs: BigEvent[]): string {
  const share = views.slice(0, 30).map((v) => {
    const tot = v.m.mid.buyValue + v.m.mid.sellValue + v.m.mid.unknownValue;
    const big = v.m.mid.bigBuy + v.m.mid.bigSell;
    return `<tr><td class="l code" data-code="${esc(v.code)}">${esc(v.code)}</td><td>${tot ? pct(big / tot) : "—"}</td><td>${tot ? pct(1 - big / tot) : "—"}</td>
      <td class="up">${fmtRp(v.m.mid.bigBuy, false)}</td><td class="down">${fmtRp(v.m.mid.bigSell, false)}</td><td>${fmtNum(v.bigLot)}</td></tr>`;
  }).join("");
  const fmtT = (ts: number) => new Date(ts + 7 * 3600e3).toISOString().slice(11, 19);
  const last = bigs.slice(0, 10).map((b) => `<tr><td>${fmtT(b.ts)}</td><td class="l code" data-code="${esc(b.code)}">${esc(b.code)}</td><td>${fmtNum(b.price)}</td>
    <td>${fmtNum(b.lot)}${b.trades > 1 ? ` <span class="small">(${b.trades}x)</span>` : ""}</td><td>${fmtRp(b.clusterValue, false)}${b.superBig ? " 🔥" : ""}</td>
    <td class="${b.side === "BUY" ? "up" : "down"}">${b.side}</td><td>${b.buyer ?? "—"}${b.buyerType ? ` [${b.buyerType}]` : ""}</td>
    <td>${b.seller ?? "—"}${b.sellerType ? ` [${b.sellerType}]` : ""}</td></tr>`).join("");
  const r = views[0]?.roles[1] ?? "3m";
  return `<table><thead><tr><th class="l">KODE</th><th>% BESAR ${r}</th><th>% LAINNYA</th><th>BIG BUY</th><th>BIG SELL</th><th>AMBANG LOT</th></tr></thead><tbody>${share}</tbody></table>
    <div style="height:10px"></div>
    <table><thead><tr><th>JAM</th><th class="l">KODE</th><th>HARGA</th><th>LOT</th><th>VALUE</th><th>SISI</th><th>BUYER</th><th>SELLER</th></tr></thead><tbody>${last ||
      `<tr><td colspan="8" class="muted">belum ada lot besar</td></tr>`}</tbody></table>
    <div class="note">Lot besar = max(P95 500 trade terakhir, minimum per harga, nilai minimum / harga). 🔥 = super besar. (Nx) = gabungan split order.</div>`;
}

export function partyTable(views: EmitenView[], brokerVisible: boolean): string {
  const rows = views.filter((v) => v.party).slice(0, 40).map((v) => {
    const p = v.party!;
    return `<tr><td class="l code" data-code="${esc(v.code)}">${esc(v.code)}</td><td class="${sgn(p.foreign)}">${fmtRp(p.foreign)}</td>
      <td class="${sgn(p.localInst)}">${fmtRp(p.localInst)}</td><td class="${sgn(p.retail)}">${fmtRp(p.retail)}</td>
      <td class="${sgn(p.sessForeign)}">${fmtRp(p.sessForeign)}</td><td class="l small">D/F + broker</td></tr>`;
  }).join("");
  if (!rows) {
    return `<div class="empty">${brokerVisible ? "Belum ada data." : "Kode broker / [D][F] tidak tampil di running trade: pemisahan asing/lokal hanya ESTIMASI."}</div>`;
  }
  const r = views[0]?.roles[1] ?? "3m";
  return `<table><thead><tr><th class="l">KODE</th><th>ASING ${r}</th><th>LOKAL INST ${r}</th><th>RITEL ${r}</th><th>ASING SESI</th><th class="l">SUMBER</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="note">[F] = asing (dari layar). Lokal inst / ritel memakai brokers.json yang BELUM terverifikasi (hanya bobot). Tab lengkap di tahap 6.</div>`;
}

export function tradesTable(trades: TradeRow[], rtVisible: boolean): string {
  if (!rtVisible) return `<div class="empty">Panel Running Trade Stockbit belum terbuka (ikon ke-3 di sisi kanan).</div>`;
  const body = trades.map((t) => `<tr><td>${t.time}</td><td class="l code" data-code="${esc(t.code)}">${esc(t.code)}</td><td>${fmtNum(t.price)}</td>
    <td>${fmtNum(t.lot, t.lot % 1 ? 2 : 0)}</td><td>${fmtRp(t.value, false)}</td>
    <td class="${t.side === "BUY" ? "up" : t.side === "SELL" ? "down" : ""}">${t.side}</td>
    <td>${t.buyer ?? "—"}</td><td>${t.seller ?? "—"}</td><td>${t.board}</td></tr>`).join("");
  return `<table><thead><tr><th>JAM</th><th class="l">KODE</th><th>HARGA</th><th>LOT</th><th>VALUE</th><th>SISI</th><th>BUYER</th><th>SELLER</th><th>PASAR</th></tr></thead>
    <tbody>${body}</tbody></table><div class="note">10 trade terbaru yang terbaca. Sinyal hanya dari pasar RG.</div>`;
}

const OWNER_CLS: Record<string, string> = { foreign: "b-red", local: "b-blue", bumn: "b-green" };
const brokerChips = (xs: BsSummary["topBuyers"]) =>
  xs.map((x) => `<span class="badge ${OWNER_CLS[x.owner ?? ""] ?? "b-grey"}" title="${x.owner ?? "?"}">${esc(x.broker)} ${fmtRp(x.value, false)}</span>`).join("");

/** Tabel ringkasan Broker Summary yang dikumpulkan dari halaman stockbit.com/symbol/KODE. */
export function brokerSummaryTable(list: BsSummary[], now: number): string {
  if (!list.length) {
    return `<div class="empty">Belum ada Broker Summary. Buka <b>stockbit.com/symbol/KODE</b> (mis. BBCA) di tab lain:
      widget Broker Summary di kolom kanan dibaca otomatis lalu muncul di sini.</div>`;
  }
  const rows = list.map((s) => {
    const ad = s.accDistLabel === "AKUMULASI" ? "b-green" : s.accDistLabel === "DISTRIBUSI" ? "b-red" : "b-grey";
    return `<tr><td class="l code" data-code="${esc(s.code)}">${esc(s.code)}</td>
      <td class="l">${esc(s.dateText ?? "—")}<div class="small">${esc([s.investor, s.board, s.mode].filter(Boolean).join(" • "))}</div></td>
      <td class="${sgn(s.net.foreign)}">${fmtRp(s.net.foreign)}</td><td class="${sgn(s.net.local)}">${fmtRp(s.net.local)}</td>
      <td class="${sgn(s.net.bumn)}">${fmtRp(s.net.bumn)}</td>
      <td class="l">${brokerChips(s.topBuyers)}</td><td class="l">${brokerChips(s.topSellers)}</td>
      <td class="l">${s.accDistLabel ? `<span class="badge ${ad}">${s.accDistLabel}</span>` : "—"}<div class="small">${s.accDist == null ? "" : `${s.accDist > 0 ? "+" : ""}${fmtNum(s.accDist * 100, 0)}%`}</div></td>
      <td>${ago(now, s.capturedAt)}</td></tr>`;
  }).join("");
  return `<table><thead><tr><th class="l">KODE</th><th class="l">TANGGAL / FILTER</th><th>BROKER ASING NET</th><th>LOKAL NET</th><th>BUMN NET</th>
    <th class="l">TOP BUYER</th><th class="l">TOP SELLER</th><th class="l">TOP 3</th><th>DIAMBIL</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="note">Sumber: widget Broker Summary Stockbit. Warna = kategori broker menurut Stockbit (merah asing, biru lokal, hijau BUMN):
    kepemilikan broker, BUKAN kebangsaan investor. Untuk investor asing saja, pilih filter "Foreign" di Stockbit lalu buka ulang halamannya.
    Label TOP 3 (AKUMULASI/DISTRIBUSI) = hitungan radar, ESTIMASI.</div>`;
}
