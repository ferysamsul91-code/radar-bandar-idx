/** Tab JEJAK INSTITUSI: rangkaian beli/jual besar dari broker yang sama (running trade live). */
import type { BrokerNet, InstEvent, InstTraceCfg } from "../core/instTrace";
import type { LiveCategory, LiveEvent, LiveTraceCfg, LiveTraceTracker } from "../core/liveTrace";
import { esc, fmtNum, fmtRp } from "./views";

const WIB = 7 * 3600e3;
const hms = (ts: number) => new Date(ts + WIB).toISOString().slice(11, 19);
const dur = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} dtk` : `${Math.floor(s / 60)} mnt ${s % 60} dtk`;
};

export interface InstTraceState {
  events: InstEvent[];
  nets: BrokerNet[];
  cfg: InstTraceCfg;
  /** Pola lot besar live tanpa broker (opsional). */
  live?: { events: LiveEvent[]; summary: ReturnType<LiveTraceTracker["summary"]>; cfg: LiveTraceCfg };
}

export function instTraceView(s: InstTraceState, now: number, rtOpen: boolean, brokerVisible: boolean, watch: ReadonlySet<string>): string {
  const c = s.cfg;
  const rule = `Aturan: broker sama, jeda ≤ ${Math.round(c.windowSec / 60)} mnt, ≥ ${c.minTrades} trade bernilai ≥ ${fmtRp(c.minTradeValue, false)}, total ≥ ${fmtRp(c.minRunValue, false)}.
    Broker ritel dikecualikan: <b>${esc(c.excludeBrokers.join(", ") || "-")}</b>${c.skipCross ? " • trade silang dilewati" : ""}. Ubah di ⚙ Settings → Ambang → instTrace.`;
  const warn = !rtOpen
    ? `<div class="small warn">⚠ Panel Running Trade Stockbit belum terbuka: jejak hanya terbaca selama panel itu terbuka di jam bursa.</div>`
    : !brokerVisible
      ? `<div class="small warn">⚠ Kode broker tidak tampil di running trade: jejak per broker tidak bisa dihitung.</div>`
      : "";
  const live = liveTraceSection(s.live, now);
  const head = `${live}<h4 class="sec">JEJAK PER BROKER <span class="small">(butuh kode broker: setelah bursa tutup)</span></h4><div class="small muted">${rule}</div>${warn}`;
  if (!s.events.length) {
    return `${head}<div class="small muted" style="margin:6px 0">Belum ada jejak per broker pada sesi ini.</div>`;
  }
  const net = s.nets.slice(0, 25).map((n) => {
    const v = n.buy - n.sell;
    return `<tr><td class="l code" data-code="${esc(n.code)}">${esc(n.code)}${watch.has(n.code) ? '<span class="badge b-blue">W</span>' : ""}</td>
      <td class="l"><b>${esc(n.broker)}</b></td>
      <td class="${v > 0 ? "up" : v < 0 ? "down" : ""}"><b>${fmtRp(v)}</b></td>
      <td class="up">${n.buy ? fmtRp(n.buy, false) : "—"}<div class="small">${n.buyLot ? `${fmtNum(n.buyLot)} lot @${fmtNum(n.buyAvg)}` : ""}</div></td>
      <td class="down">${n.sell ? fmtRp(n.sell, false) : "—"}<div class="small">${n.sellLot ? `${fmtNum(n.sellLot)} lot @${fmtNum(n.sellAvg)}` : ""}</div></td>
      <td>${n.runs}</td></tr>`;
  }).join("");
  const evs = s.events.slice(0, 40).map((e) => {
    const active = now - e.lastTs <= c.windowSec * 1000;
    const f = e.foreignShare === null ? "" : e.foreignShare >= 0.5 ? ' <span class="badge b-red" title="mayoritas investor [F]">F</span>' : ' <span class="badge b-grey" title="mayoritas investor [D]">D</span>';
    return `<tr><td>${hms(e.startTs)}<div class="small">${dur(e.lastTs - e.startTs)}</div></td>
      <td class="l code" data-code="${esc(e.code)}">${esc(e.code)}</td>
      <td class="l"><b>${esc(e.broker)}</b>${f}</td>
      <td class="l"><span class="badge ${e.side === "BELI" ? "b-green" : "b-red"}">${e.side}</span></td>
      <td>${fmtNum(e.lot)}</td><td>${fmtRp(e.value, false)}</td><td>${fmtNum(e.avg)}</td><td>${e.trades}</td>
      <td class="l">${active ? '<span class="badge b-orange">AKTIF</span>' : '<span class="small muted">selesai</span>'}</td></tr>`;
  }).join("");
  return `${head}
    <h4 class="sec">NET PER BROKER PER EMITEN (sesi ini)</h4>
    <table><thead><tr><th class="l">KODE</th><th class="l">BROKER</th><th>NET</th><th>BELI</th><th>JUAL</th><th>RANGKAIAN</th></tr></thead><tbody>${net}</tbody></table>
    <h4 class="sec">KEJADIAN TERBARU</h4>
    <table><thead><tr><th>MULAI</th><th class="l">KODE</th><th class="l">BROKER</th><th class="l">SISI</th><th>LOT</th><th>NILAI</th><th>AVG</th><th>TRADE</th><th class="l">STATUS</th></tr></thead><tbody>${evs}</tbody></table>
    <div class="note">Jejak = pola transaksi, bukan identitas pemilik dana. Broker non-ritel bisa juga melayani nasabah perorangan besar;
      F/D = tipe investor mayoritas dari tanda [F]/[D] di running trade. Hanya trade yang terlihat selama panel Running Trade terbuka.
      Bukan rekomendasi beli/jual.</div>`;
}

/** Bagian POLA LOT BESAR LIVE (tanpa broker): kategori dari F Buy/F Sell widget orderbook. */
export function liveTraceSection(live: { events: LiveEvent[]; summary: ReturnType<LiveTraceTracker["summary"]>; cfg: LiveTraceCfg } | undefined, now: number): string {
  if (!live) return "";
  const c = live.cfg;
  const CAT: Record<LiveCategory, string> = { ASING: "b-red", "INSTITUSI/LOKAL": "b-blue", "?": "b-grey" };
  const rule = `Tanpa kode broker (disembunyikan BEI saat jam bursa): rangkaian lot besar per emiten & sisi agresor, jeda ≤ ${Math.round(c.windowSec / 60)} mnt,
    ≥ ${c.minTrades} trade ≥ ${fmtRp(c.minTradeValue, false)}, total ≥ ${fmtRp(c.minRunValue, false)}. <b>ASING</b> bila F Buy/F Sell widget orderbook naik
    ≥ ${Math.round(c.foreignShareMin * 100)}% nilai rangkaian; <b>INSTITUSI/LOKAL</b> bila tidak; <b>?</b> bila emiten tidak punya widget orderbook terbuka.`;
  const head = `<h4 class="sec">POLA LOT BESAR LIVE <span class="small">(${live.events.length} kejadian)</span></h4><div class="small muted">${rule}</div>`;
  if (!live.events.length) return `${head}<div class="small muted" style="margin:6px 0">Belum ada pola pada sesi ini.</div>`;
  const sum = live.summary.slice(0, 15).map((s) => {
    const net = s.buy - s.sell;
    return `<tr><td class="l code" data-code="${esc(s.code)}">${esc(s.code)}</td><td class="${net > 0 ? "up" : net < 0 ? "down" : ""}"><b>${fmtRp(net)}</b></td>
      <td class="up">${s.buy ? fmtRp(s.buy, false) : "—"}</td><td class="down">${s.sell ? fmtRp(s.sell, false) : "—"}</td>
      <td>${s.asingBuy ? fmtRp(s.asingBuy, false) : "—"}</td><td>${s.asingSell ? fmtRp(s.asingSell, false) : "—"}</td><td>${s.runs}</td></tr>`;
  }).join("");
  const evs = live.events.slice(0, 30).map((e) => {
    const active = now - e.lastTs <= c.windowSec * 1000;
    return `<tr><td>${hms(e.startTs)}<div class="small">${dur(e.lastTs - e.startTs)}</div></td>
      <td class="l code" data-code="${esc(e.code)}">${esc(e.code)}</td>
      <td class="l"><span class="badge ${e.side === "BELI" ? "b-green" : "b-red"}">${e.side}</span></td>
      <td class="l"><span class="badge ${CAT[e.category]}">${e.category}</span><div class="small">${e.foreignShare === null ? "tanpa widget" : `ΔF ${fmtRp(e.foreignDelta, false)} (${Math.round(e.foreignShare * 100)}%)`}</div></td>
      <td>${fmtNum(e.lot)}</td><td>${fmtRp(e.value, false)}</td><td>${fmtNum(e.avg)}</td><td>${e.trades}</td>
      <td class="l">${active ? '<span class="badge b-orange">AKTIF</span>' : '<span class="small muted">selesai</span>'}</td></tr>`;
  }).join("");
  return `${head}
    <table><thead><tr><th class="l">KODE</th><th>NET POLA</th><th>BELI</th><th>JUAL</th><th>ASING BELI</th><th>ASING JUAL</th><th>RANGKAIAN</th></tr></thead><tbody>${sum}</tbody></table>
    <table style="margin-top:8px"><thead><tr><th>MULAI</th><th class="l">KODE</th><th class="l">SISI</th><th class="l">KATEGORI</th><th>LOT</th><th>NILAI</th><th>AVG</th><th>TRADE</th><th class="l">STATUS</th></tr></thead><tbody>${evs}</tbody></table>
    <div class="note">ESTIMASI berbasis pola: F Buy/F Sell mencakup semua transaksi asing di emiten itu (bukan hanya rangkaian ini). Sisi = agresor;
      akumulasi pasif di bid tampil sebagai rangkaian JUAL. Buka widget orderbook untuk emiten pantauan agar kategori asing terukur.</div>`;
}
