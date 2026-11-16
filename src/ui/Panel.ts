import type { Toast } from "../core/alerts";
import type { BigEvent, EmitenView } from "../core/engine";
import type { UserSettings } from "../core/settings";
import { brokerRowHtml, readSettingsForm, SETTINGS_CSS, settingsHtml, type SettingsInfo } from "./settingsView";
import { PANEL_CSS } from "./styles";
import { bigTable, bookTable, brokerSummaryTable, esc, lifecycleList, partyTable, scannerTable, tradesTable } from "./views";
import type { BsSummary } from "../core/brokerSummary";
import type { ForeignSnap, InstSnap } from "../core/rekap";
import type { RangeMode, RangeSel, RekapHistory } from "../core/rekapRange";
import { REKAP_CSS, rekapView } from "./rekapView";
import { instTraceView, type InstTraceState } from "./instTraceView";
import { divergenceView } from "./divergenceView";
import { normalizeScanList } from "../core/scanList";
import { DEFAULT_AUTO, type AutoRekapCfg } from "../core/autoRekap";
import type { ChartStore } from "../core/chartStore";
import { DEFAULT_DIV, type DivCfg } from "../core/divergence";
import { DEFAULT_INST_TRACE } from "../core/instTrace";

export interface RekapSources {
  fb: ForeignSnap | null;
  fs: ForeignSnap | null;
  inst: InstSnap | null;
}

export const VERSION = "0.14.0";
export const HOST_ID = "radar-bandar-idx-host";

export type Mode = "SCALPING" | "INTRADAY";
export const SUB_TABS = [
  "SCANNER", "PADA BELI", "CUAN MENANTI", "🔥 FLOW KUAT", "⭐ PRIORITAS",
  "PADA JUALAN", "BELI vs JUAL", "BID–OFFER", "BESAR / RITEL", "ASING / LOKAL", "JEJAK INSTITUSI", "REKAP", "DIVERGENCE",
] as const;

export interface PanelState {
  mode: Mode;
  tab: (typeof SUB_TABS)[number];
  paused: boolean;
  compact: boolean;
  minimized: boolean;
  trades: number;
  dup: number;
  parserPct: number | null; // null = parser belum aktif
  obOk: number;
  obTotal: number;
  bookRows: BookRow[];
  /** null = panel Running Trade tidak terlihat. */
  rtFreshSec: number | null;
  brokerVisible: boolean;
  recentTrades: TradeRow[];
  /** Hasil engine untuk mode aktif, urut skor (watchlist di atas, blacklist dibuang). */
  views: EmitenView[];
  bigs: BigEvent[];
  now: number;
  phase: string;
  watch: string[];
  /** Ringkasan Broker Summary dari halaman /symbol/KODE (chrome.storage.local). */
  bs: BsSummary[];
  /** Sumber REKAP penutupan (Movers Net Foreign + Broker Analysis), dari chrome.storage.local. */
  rekap: RekapSources;
  /** Riwayat REKAP per hari bursa / rentang. */
  rekapHist: RekapHistory;
  /** Pilihan rentang di tab REKAP. */
  rekapRange: RangeSel;
  /** Hari bursa terakhir (YYYY-MM-DD) menurut jam sesi. */
  tradingDay: string;
  /** JEJAK INSTITUSI dari running trade. */
  inst: InstTraceState;
  /** Data REKAP hari bursa terakhir yang belum diambil (null = tidak perlu diingatkan). */
  rekapMissing: string[] | null;
  /** Candle Chartbit tersimpan per emiten (Table view). */
  charts: ChartStore[];
  divCfg: DivCfg;
  /** Daftar Pindai DIVERGENCE (semi-manual). */
  scanList: string[];
  /** Hasil AUTO REKAP terakhir & konfigurasinya. */
  autoInfo: string;
  autoCfg: AutoRekapCfg;
  /** PUBLIKASI ONLINE (opsional): aktif? + status kiriman terakhir. */
  publishOn: boolean;
  publishInfo: string;
}

export interface TradeRow {
  time: string;
  code: string;
  price: number;
  lot: number;
  value: number;
  side: "BUY" | "SELL" | "UNKNOWN";
  buyer?: string;
  seller?: string;
  board: string;
}

export interface BookRow {
  code: string;
  last: number | null;
  bestBid: number | null;
  bestOffer: number | null;
  aqi: number | null;
  depth: number | null;
  foreignNet: number | null;
  ok: boolean;
}

/** Penghubung panel ke content script. Semua aksi lokal. */
export interface PanelHooks {
  onCodeClick?(code: string): boolean;
  /** Simpan settings; kembalikan pesan error (kosong = berhasil). */
  onSave?(s: UserSettings): string[];
  onExport?(fmt: "csv" | "jsonl"): void;
  onReset?(): void;
  onExportRekap?(): void;
  onExportRekapPdf?(): void;
  onExportBackup?(): void;
  onSaveScanList?(codes: string[]): void;
  onAutoRekap?(): void;
  onPublish?(): void;
  onPublishSettings?(): void;
  /** Kembalikan pesan hasil impor. */
  onImportBackup?(text: string): string;
  getSettings?(): { current: UserSettings; defaults: UserSettings; info: SettingsInfo };
}

/**
 * Panel melayang di dalam Shadow DOM (CSS Stockbit tidak bocor ke panel dan sebaliknya).
 * Dirender ulang tiap update (maks 2x/detik); posisi, ukuran & scroll dipertahankan.
 * Saat Settings terbuka, isi panel tidak dirender ulang agar form tidak hilang.
 */
export class Panel {
  readonly host: HTMLElement;
  private root: ShadowRoot;
  private mount: HTMLElement;
  private toastBox: HTMLElement;
  private el!: HTMLElement;
  hooks: PanelHooks = {};
  settingsOpen = false;
  private hint: string | null = null;
  /** True selama dialog pilih file (impor) terbuka: jangan render ulang agar input file tidak diganti. */
  private holdRender = false;
  state: PanelState = {
    mode: "SCALPING", tab: "SCANNER", paused: false, compact: false, minimized: false,
    trades: 0, dup: 0, parserPct: null, obOk: 0, obTotal: 0, bookRows: [], rtFreshSec: null, brokerVisible: false,
    recentTrades: [], views: [], bigs: [], now: Date.now(), phase: "", watch: [], bs: [], rekap: { fb: null, fs: null, inst: null },
    rekapHist: { fbuy: {}, fsell: {}, inst: {} }, rekapRange: { mode: "latest" }, tradingDay: "",
    inst: { events: [], nets: [], cfg: DEFAULT_INST_TRACE }, rekapMissing: null, charts: [], divCfg: DEFAULT_DIV, scanList: [], autoInfo: "", autoCfg: DEFAULT_AUTO, publishOn: false, publishInfo: "",
  };

  constructor(doc: Document = document) {
    const existing = doc.getElementById(HOST_ID);
    if (existing) existing.remove();
    this.host = doc.createElement("div");
    this.host.id = HOST_ID;
    this.root = this.host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = PANEL_CSS + SETTINGS_CSS + REKAP_CSS;
    this.mount = doc.createElement("div");
    this.toastBox = doc.createElement("div");
    this.toastBox.className = "toasts";
    this.root.append(style, this.mount, this.toastBox);
    doc.documentElement.appendChild(this.host);
    this.render();
  }

  private renderBody(): string {
    const s = this.state;
    const v = s.views;
    const watch = new Set(s.watch);
    const noRt = s.rtFreshSec === null ? "Panel Running Trade Stockbit belum terbuka (ikon ke-3 di sisi kanan)." : "Belum ada trade RG yang terbaca.";
    const tbl = (xs: EmitenView[], empty: string) => scannerTable(xs, s.now, s.compact, empty, watch);
    const pick = (f: (x: EmitenView) => boolean, empty: string) => tbl(v.filter(f), v.length ? empty : noRt);
    switch (s.tab) {
      case "SCANNER":
        return tbl(v, noRt) + '<div style="height:10px"></div>' + tradesTable(s.recentTrades, s.rtFreshSec !== null);
      case "PADA BELI": return pick((x) => x.status === "PADA BELI", "Tidak ada emiten PADA BELI.");
      case "CUAN MENANTI": return pick((x) => x.status === "CUAN MENANTI", "Tidak ada emiten CUAN MENANTI (butuh widget orderbook dengan bid bertahan).");
      case "🔥 FLOW KUAT": return pick((x) => x.status === "FLOW KUAT", "Tidak ada emiten FLOW KUAT.");
      case "⭐ PRIORITAS": return pick((x) => (x.score.grade === "A+" || x.score.grade === "A" || x.stars > 0) && x.q >= 50, "Belum ada prioritas (A/A+ atau ★).");
      case "PADA JUALAN": return pick((x) => x.status === "PADA JUALAN", "Tidak ada emiten PADA JUALAN.");
      case "BELI vs JUAL": return tbl([...v].sort((a, b) => b.m.mid.aggrFlow - a.m.mid.aggrFlow), noRt);
      case "BID–OFFER": return bookTable(s.bookRows) + '<div style="height:10px"></div>' + lifecycleList(v, s.now);
      case "BESAR / RITEL": return bigTable(v, s.bigs);
      case "JEJAK INSTITUSI": return instTraceView(s.inst, s.now, s.rtFreshSec !== null, s.brokerVisible, new Set(s.watch));
      case "DIVERGENCE": return divergenceView(s.charts, s.divCfg, new Set(s.watch), s.scanList, s.tradingDay);
      case "REKAP": return rekapView(s.rekap, s.rekapHist, s.rekapRange, s.tradingDay, s.now, s.rekapMissing, { info: s.autoInfo, cfg: s.autoCfg, pubOn: s.publishOn, pubInfo: s.publishInfo });
      case "ASING / LOKAL":
        return `<h4 class="sec">RUNNING TRADE (D/F + broker)</h4>${partyTable(v, s.brokerVisible)}<h4 class="sec">BROKER SUMMARY</h4>${brokerSummaryTable(s.bs, s.now)}`;
    }
  }

  private fmtDate(): string {
    return new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  }

  private statusBar(): string {
    const s = this.state;
    const parser = s.parserPct === null ? "PARSER —" : `PARSER ${s.parserPct}`;
    return `
      <span class="${s.paused ? "paused" : "live"}">● ${s.paused ? "JEDA" : "LIVE"}</span>
      <span>• ${s.trades.toLocaleString("id-ID")} trades</span>
      <span>• ${s.mode}</span>
      <span>• ${this.fmtDate()}${s.phase ? ` ${esc(s.phase)}` : ""}</span>
      <span>| LOCAL MODE</span>
      <span>• DUP ${s.dup.toLocaleString("id-ID")}</span>
      <span class="${s.parserPct === null || s.parserPct < 95 ? "warn" : ""}">• ${parser}</span>
      <span>• OB ${s.obOk}/${s.obTotal}</span>
      ${s.rtFreshSec === null ? `<span class="warn">• RT: buka panel Running Trade</span>` : `<span>• RT FRESH ${s.rtFreshSec}</span><span>• BROKER ${s.brokerVisible ? "TAMPIL" : "TIDAK TAMPIL"}</span>`}
      ${s.rekapMissing?.length ? `<span class="warn" title="Buka Movers & Broker Analysis, atau biarkan Running Trade terbuka saat bursa">• REKAP ${esc(s.tradingDay)} belum: ${esc(s.rekapMissing.join(", "))}</span>` : ""}
      ${this.hint ? `<span class="warn">• ${esc(this.hint)}</span>` : ""}`;
  }

  render(): void {
    const s = this.state;
    const tabs = SUB_TABS.map((t) => `<button data-tab="${t}" class="${t === s.tab ? "on" : ""}">${t}</button>`).join("");
    this.mount.innerHTML = `
      <div class="rb${s.minimized ? " min" : ""}" part="panel">
        <div class="hdr" data-drag>
          <span class="title">Radar Bandar IDX</span><span class="ver">v${VERSION}</span>
          <span class="sub">Running Trade → Scalping Flow</span>
          <span class="sp"></span>
          <button data-act="pause" class="${s.paused ? "on" : ""}">${s.paused ? "LANJUT" : "JEDA"}</button>
          <button data-act="compact" class="${s.compact ? "on" : ""}">COMPACT</button>
          <button data-act="settings" class="${this.settingsOpen ? "on" : ""}" title="Settings">⚙</button>
          <button data-act="min" title="Minimize">—</button>
          <button data-act="close" title="Tutup">✕</button>
        </div>
        <div class="status">${this.statusBar()}</div>
        ${this.settingsOpen ? "" : `<div class="tabs">
          <button data-mode="SCALPING" class="${s.mode === "SCALPING" ? "on" : ""}">SCALPING</button>
          <button data-mode="INTRADAY" class="${s.mode === "INTRADAY" ? "on" : ""}">INTRADAY</button>
        </div>
        <div class="tabs">${tabs}</div>`}
        <div class="body">${this.settingsOpen ? this.settingsBody([], false) : this.renderBody()}</div>
        <div class="footer">★/A+ adalah prioritas pantau; tetap konfirmasi orderbook dan harga. Bukan rekomendasi beli/jual.</div>
      </div>`;
    this.el = this.mount.querySelector(".rb") as HTMLElement;
    this.bind();
    this.placeToasts();
  }

  private settingsBody(errors: string[], saved: boolean): string {
    const g = this.hooks.getSettings?.();
    return g ? settingsHtml(g.current, g.info, errors, saved) : `<div class="empty">Settings tidak tersedia.</div>`;
  }

  update(patch: Partial<PanelState>): void {
    Object.assign(this.state, patch);
    // Jangan render ulang saat pengguna sedang mengisi input di isi panel (mis. tanggal REKAP).
    const active = this.root.activeElement;
    const typing = !!active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName) && !!active.closest(".body");
    if (this.settingsOpen || typing || this.holdRender) {
      // Jangan sentuh form; perbarui status bar saja.
      const sb = this.mount.querySelector(".status");
      if (sb) sb.innerHTML = this.statusBar();
      return;
    }
    this.rerender();
  }

  private rerender(): void {
    const st = this.el.style;
    const pos = { left: st.left, top: st.top, right: st.right, width: st.width, height: st.height };
    const body = this.mount.querySelector(".body");
    const scroll = body ? body.scrollTop : 0;
    // Pertahankan buka/tutup bagian <details> (termasuk yang bawaannya terbuka lalu ditutup pengguna).
    const prev = [...this.mount.querySelectorAll<HTMLDetailsElement>("details[data-key]")];
    const seen = new Set(prev.map((d) => d.dataset.key));
    const open = new Set(prev.filter((d) => d.open).map((d) => d.dataset.key));
    this.render();
    this.mount.querySelectorAll<HTMLDetailsElement>("details[data-key]").forEach((d) => {
      if (seen.has(d.dataset.key)) d.open = open.has(d.dataset.key);
    });
    Object.assign(this.el.style, pos);
    const nb = this.mount.querySelector(".body");
    if (nb) nb.scrollTop = scroll;
    this.placeToasts();
  }

  /** Tampilkan antrean toast di bawah panel. Klik toast = isi kotak pencarian kode. */
  showToasts(list: Toast[]): void {
    this.toastBox.innerHTML = list
      .map((t) => `<div class="toast ${t.kind}" data-code="${esc(t.code)}">${esc(t.text)}</div>`)
      .join("");
    this.toastBox.querySelectorAll<HTMLElement>(".toast").forEach((d) =>
      d.addEventListener("click", () => this.codeClicked(d.dataset.code ?? "")),
    );
    this.placeToasts();
  }

  private placeToasts(): void {
    if (!this.el || !this.toastBox) return;
    const r = this.el.getBoundingClientRect();
    this.toastBox.style.left = `${Math.max(8, r.left)}px`;
    this.toastBox.style.top = `${r.bottom + 8}px`;
  }

  setHint(text: string | null): void {
    this.hint = text;
    const sb = this.mount.querySelector(".status");
    if (sb) sb.innerHTML = this.statusBar();
  }

  destroy(): void {
    this.host.remove();
  }

  private codeClicked(code: string): void {
    if (!code) return;
    const ok = this.hooks.onCodeClick?.(code) ?? false;
    this.setHint(ok ? `${code} diisi ke pencarian orderbook` : "Kotak pencarian orderbook tidak ditemukan");
    setTimeout(() => this.setHint(null), 3000);
  }

  private bind(): void {
    this.mount.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const act = b.dataset.act;
        if (act === "pause") this.update({ paused: !this.state.paused });
        else if (act === "compact") this.update({ compact: !this.state.compact });
        else if (act === "min") this.update({ minimized: !this.state.minimized });
        else if (act === "close") this.destroy();
        else if (act === "settings") {
          this.settingsOpen = !this.settingsOpen;
          this.rerender();
        }
      }),
    );
    this.mount.querySelectorAll<HTMLButtonElement>("button[data-mode]").forEach((b) =>
      b.addEventListener("click", () => this.update({ mode: b.dataset.mode as Mode })),
    );
    this.mount.querySelectorAll<HTMLButtonElement>("button[data-tab]").forEach((b) =>
      b.addEventListener("click", () => this.update({ tab: b.dataset.tab as PanelState["tab"] })),
    );
    this.mount.querySelector<HTMLButtonElement>(".body button[data-rekap=csv]")?.addEventListener("click", () => this.hooks.onExportRekap?.());
    this.mount.querySelector<HTMLButtonElement>(".body button[data-rekap=pdf]")?.addEventListener("click", () => this.hooks.onExportRekapPdf?.());
    this.mount.querySelector<HTMLButtonElement>(".body button[data-rekap=publish]")?.addEventListener("click", () => {
      this.hooks.onPublish?.();
      this.setHint("PUBLIKASI: mengenkripsi & mengirim…");
    });
    this.mount.querySelector<HTMLButtonElement>(".body button[data-rekap=pubcfg]")?.addEventListener("click", () => this.hooks.onPublishSettings?.());
    this.mount.querySelector<HTMLButtonElement>(".body button[data-rekap=auto]")?.addEventListener("click", () => {
      this.hooks.onAutoRekap?.();
      this.setHint("AUTO REKAP: dimulai…");
    });
    this.mount.querySelectorAll<HTMLButtonElement>(".body button[data-scan]").forEach((b) =>
      b.addEventListener("click", () => {
        const act = b.dataset.scan;
        const ta = this.mount.querySelector<HTMLTextAreaElement>(".body .scan-list");
        const list = act === "save" ? normalizeScanList(ta?.value ?? "") : act === "watch" ? [...this.state.watch] : [];
        this.hooks.onSaveScanList?.(list);
        this.update({ scanList: list });
        this.setHint(act === "clear" ? "Daftar pindai dikosongkan" : `Daftar pindai: ${list.length} emiten`);
        setTimeout(() => this.setHint(null), 3000);
      }),
    );
    this.mount.querySelectorAll<HTMLButtonElement>(".body button[data-rr-src]").forEach((b) =>
      b.addEventListener("click", () => this.update({ rekapRange: { ...this.state.rekapRange, instSrc: b.dataset.rrSrc as "ba" | "trace" } })),
    );
    this.mount.querySelector<HTMLButtonElement>(".body button[data-bk=export]")?.addEventListener("click", () => this.hooks.onExportBackup?.());
    const file = this.mount.querySelector<HTMLInputElement>(".body .bk-file");
    this.mount.querySelector<HTMLButtonElement>(".body button[data-bk=import]")?.addEventListener("click", () => {
      this.holdRender = true;
      // Dialog ditutup (dipilih atau batal): jendela kembali fokus.
      window.addEventListener("focus", () => setTimeout(() => (this.holdRender = false), 1500), { once: true });
      file?.click();
    });
    file?.addEventListener("change", () => {
      this.holdRender = false;
      const f = file.files?.[0];
      if (!f) return;
      void f.text().then((txt) => {
        const msg = this.hooks.onImportBackup?.(txt) ?? "Impor tidak tersedia";
        this.setHint(msg);
        setTimeout(() => this.setHint(null), 6000);
      });
    });
    this.mount.querySelectorAll<HTMLButtonElement>(".body button[data-rr]").forEach((b) =>
      b.addEventListener("click", () => {
        const mode = b.dataset.rr as RangeMode | "apply" | "use";
        const body = this.mount.querySelector(".body");
        const val = (sel: string) => body?.querySelector<HTMLInputElement>(sel)?.value || undefined;
        if (mode === "apply") this.update({ rekapRange: { mode: "custom", from: val(".rr-from"), to: val(".rr-to") } });
        else if (mode === "use") this.update({ rekapRange: { mode: "custom", from: b.dataset.from, to: b.dataset.to } });
        else this.update({ rekapRange: { ...this.state.rekapRange, mode } });
      }),
    );
    this.mount.querySelectorAll<HTMLElement>(".body [data-code]").forEach((c) =>
      c.addEventListener("click", () => this.codeClicked(c.dataset.code ?? "")),
    );
    if (this.settingsOpen) this.bindSettings();
    this.enableDrag();
  }

  private bindSettings(): void {
    const body = this.mount.querySelector<HTMLElement>(".body");
    if (!body) return;
    body.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-sact]");
      if (!b) return;
      const act = b.dataset.sact;
      const g = this.hooks.getSettings?.();
      if (act === "close") {
        this.settingsOpen = false;
        this.rerender();
      } else if (act === "addrow") {
        body.querySelector(".b-body")?.insertAdjacentHTML("beforeend", brokerRowHtml());
      } else if (act === "delrow") {
        b.closest("tr")?.remove();
      } else if (act === "csv" || act === "jsonl") {
        this.hooks.onExport?.(act);
      } else if (act === "reset") {
        this.hooks.onReset?.();
        body.innerHTML = this.settingsBody([], false);
      } else if (act === "defaults" && g) {
        const errs = this.hooks.onSave?.(structuredClone(g.defaults)) ?? [];
        body.innerHTML = this.settingsBody(errs, errs.length === 0);
      } else if (act === "save" && g) {
        const r = readSettingsForm(body, g.current, g.defaults);
        const errs = r.settings ? (this.hooks.onSave?.(r.settings) ?? []) : r.errors;
        if (errs.length) {
          const box = body.querySelector(".set-hdr");
          body.querySelector(".err, .ok")?.remove();
          box?.insertAdjacentHTML("afterend", `<div class="err">${errs.map(esc).join("<br>")}</div>`);
          body.scrollTop = 0;
        } else {
          body.innerHTML = this.settingsBody([], true);
        }
      }
    });
  }

  private enableDrag(): void {
    const handle = this.mount.querySelector<HTMLElement>("[data-drag]");
    if (!handle) return;
    handle.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      const rect = this.el.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      const move = (ev: PointerEvent) => {
        this.el.style.right = "auto";
        this.el.style.left = `${Math.max(0, ev.clientX - dx)}px`;
        this.el.style.top = `${Math.max(0, ev.clientY - dy)}px`;
        this.placeToasts();
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        try {
          chrome.storage?.local.set({ rbPos: { left: this.el.style.left, top: this.el.style.top } });
        } catch { /* di luar ekstensi (mis. test) */ }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }

  restorePosition(pos: { left?: string; top?: string } | undefined): void {
    if (!pos?.left || !pos.top) return;
    this.el.style.right = "auto";
    this.el.style.left = pos.left;
    this.el.style.top = pos.top;
    this.placeToasts();
  }
}
