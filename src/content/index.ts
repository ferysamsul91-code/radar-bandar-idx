/**
 * Content script Radar Bandar IDX.
 * Batasan: hanya membaca DOM yang tampil. Tidak memanggil API Stockbit, tidak membaca
 * cookie/token, tidak mengirim data ke luar, tidak ada order.
 * Satu-satunya tulisan ke halaman: klik kode mengisi kotak pencarian orderbook yang sudah ada di layar.
 * Di stockbit.com/symbol/KODE hanya widget Broker Summary yang dibaca; ringkasannya disimpan di
 * chrome.storage.local (kunci "rbBS:KODE") lalu ditampilkan panel orderbook.
 */
import brokersJson from "../config/brokers.json";
import selectors from "../config/selectors.json";
import thresholdsJson from "../config/thresholds.json";
import { AlertManager, type ToastCfg } from "../core/alerts";
import { BrokerMap } from "../core/brokerMap";
import { DEFAULT_INST_TRACE, InstTraceTracker, type InstTraceCfg } from "../core/instTrace";
import { DEFAULT_LIVE_TRACE, LiveTraceTracker, mergeLive, summarize, type LiveEvent, type LiveTraceCfg } from "../core/liveTrace";
import { sameSummary, summarizeBrokerSummary, type BsConfig, type BsSummary } from "../core/brokerSummary";
import { parseDateRange, rekapToCSV, type ForeignSnap, type InstSnap } from "../core/rekap";
import { completeness, histKey, instRankCSV, LIVE_PREFIX, liveInstCSV, makeReport, putHistory, type LiveDay, type RekapHistory } from "../core/rekapRange";
import { makeBackup, parseBackup } from "../core/backup";
import { RadarEngine, type Thresholds } from "../core/engine";
import { classifyAggressor, type TickState } from "../core/aggressor";
import { aqi, depthRatio, foreignNet } from "../core/book";
import { Deduper } from "../core/dedup";
import { tradesToCSV, tradesToJSONL } from "../core/exporter";
import { formatCompact, screenTimeToEpoch, tradeValue } from "../core/normalize";
import { RunningTradeTracker } from "../core/rtTracker";
import { lastTradingDate, marketPhase, tradingDayKey, wibClock, type SessionCfg } from "../core/session";
import { defaultSettings, loadSettings, type UserSettings } from "../core/settings";
import type { BookSnapshot, Trade } from "../core/types";
import { Panel, type BookRow, type TradeRow } from "../ui/Panel";
import { rekapPdf } from "../ui/rekapPdf";
import { toBytes } from "../core/pdf";
import { arrangeViews, fillCodeSearch } from "./actions";
import { startDomObserver } from "./observer";
import { parseBrokerAnalysis, parseMoversForeign, type BrokerAnalysisParse, type ForeignRow } from "./parse-rekap";
import { runAutoRekap } from "./autoRekapRunner";
import { AUTO_KEY, decideAuto, DEFAULT_AUTO, EMPTY_AUTO_STATE, markRun, type AutoMode, type AutoRekapCfg, type AutoState } from "../core/autoRekap";
import { parseChartTable } from "./parse-chartbit";
import { CHART_PREFIX, chartKey, mergeBars, type ChartStore } from "../core/chartStore";
import { DEFAULT_DIV, type DivCfg } from "../core/divergence";
import { normalizeScanList, SCAN_KEY, scanProgress } from "../core/scanList";
import { parseBrokerSummary, symbolFromPath, type BrokerSummarySelectors } from "./parse-broker-summary";
import { parseOrderbookPage, type OrderbookParseResult, type OrderbookSelectors } from "./parse-orderbook";
import { parseRunningTrade, type RawTrade, type RunningTradeSelectors } from "./parse-running-trade";

/** Trade sesi disimpan di memori untuk export & hitung ulang (hilang saat tab di-refresh). */
const MAX_SESSION_TRADES = 300_000;
const BS_PREFIX = "rbBS:";
const REKAP_PREFIX = "rbRekap:";

function toBookRows(r: OrderbookParseResult): BookRow[] {
  return r.widgets.map((w) => {
    const s = w.snapshot;
    return {
      code: w.code, ok: w.ok, last: s?.last ?? null,
      bestBid: s?.bids[0]?.price ?? null, bestOffer: s?.offers[0]?.price ?? null,
      aqi: s ? aqi(s) : null, depth: s ? depthRatio(s) : null, foreignNet: s ? foreignNet(s) : null,
    };
  });
}

/** Ubah baris layar jadi Trade. Sisi: label Action Stockbit; jika tidak ada, banding bid/offer lalu tick rule. */
export function toTrade(r: RawTrade & { hash: string }, now: number, snap: BookSnapshot | undefined, tick: TickState): Trade {
  const ts = r.epochMs ?? screenTimeToEpoch(r.time, now) ?? now;
  const { side } = classifyAggressor({ ts, price: r.price, label: r.action }, snap, tick);
  return {
    ts, code: r.code, price: r.price, lot: r.lot, value: tradeValue(r.price, r.lot), side,
    buyerBroker: r.buyer, sellerBroker: r.seller, buyerType: r.buyerType, sellerType: r.sellerType,
    board: r.board, hash: r.hash,
  };
}

function beep(): void {
  try {
    const Ctx = window.AudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.05;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.15);
    o.onended = () => void ctx.close();
  } catch { /* audio diblokir browser: abaikan */ }
}

function download(name: string, data: string | Uint8Array<ArrayBuffer>, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.documentElement.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function boot(): void {
  const panel = new Panel(document);
  const obSel = selectors.orderbook as OrderbookSelectors;
  const rtSel = selectors.runningTrade as RunningTradeSelectors;
  const defaults = defaultSettings(thresholdsJson as unknown as Record<string, unknown>, brokersJson);
  let settings: UserSettings = defaults;

  const tracker = new RunningTradeTracker<RawTrade>();
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  const movers = makeMoversCollector((msg) => {
    panel.setHint(msg);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => panel.setHint(null), 4000);
  });
  const obMemo = new WeakMap<Element, string>();
  const dedup = new Deduper();
  const ticks = new Map<string, TickState>();
  let cfg = settings.thresholds as unknown as Thresholds;
  let engines = makeEngines();
  let alerts = new AlertManager((settings.thresholds.toast as ToastCfg) ?? { maxQueue: 3, cooldownSec: 60 });
  const sessionTrades: (Trade & { chgPct?: number | null })[] = [];
  const recent: Trade[] = [];
  let tradeCount = 0;
  let lastNewAt: number | null = null;
  let dayKey = tradingDayKey(Date.now(), String(settings.thresholds.dailyResetWIB ?? "08:45"));
  let lastSearch: HTMLInputElement | null = null;
  const instCfg = (): InstTraceCfg => ({ ...DEFAULT_INST_TRACE, ...((settings.thresholds.instTrace as Partial<InstTraceCfg> | undefined) ?? {}) });
  let inst = new InstTraceTracker(instCfg());
  // Pola lot besar live tanpa broker (ambang sama dengan instTrace + foreignShareMin).
  const liveCfg = (): LiveTraceCfg => {
    const c = (settings.thresholds.instTrace as Partial<LiveTraceCfg> | undefined) ?? {};
    return { ...DEFAULT_LIVE_TRACE, ...Object.fromEntries(Object.entries(c).filter(([k]) => k in DEFAULT_LIVE_TRACE)) };
  };
  let live = new LiveTraceTracker(liveCfg());
  let instSavedSig = "";
  let liveSavedSig = "";
  let histLoaded = false;
  /** Simpan net jejak institusi hari ini (riwayat lokal, untuk dibandingkan antarhari) + pola lot besar live harian. */
  const saveInst = () => {
    saveLive();
    const nets = inst.nets();
    const sig = JSON.stringify(nets);
    if (!nets.length || sig === instSavedSig) return;
    instSavedSig = sig;
    store({ [`rbInstH:${dayKey}`]: { day: dayKey, savedAt: Date.now(), cfg: instCfg(), nets } });
  };
  /** "rbLiveH:<hari>": rekaman rangkaian digabung dengan yang sudah tersimpan (aman saat halaman dimuat ulang / beberapa tab). */
  const saveLive = () => {
    if (!histLoaded || !live.events.length) return;
    const sig = JSON.stringify(live.events.map((e) => [e.id, e.value, e.category, e.lastTs]));
    if (sig === liveSavedSig) return;
    liveSavedSig = sig;
    const recs = mergeLive(rekapHist.live?.[dayKey]?.recs ?? [], live.events);
    const v: LiveDay = { day: dayKey, savedAt: Date.now(), rows: summarize(recs), recs };
    putHistory(rekapHist, LIVE_PREFIX + dayKey, v);
    store({ [LIVE_PREFIX + dayKey]: v });
  };
  setInterval(saveInst, 30_000);

  function makeEngines() {
    const bm = new BrokerMap(settings.brokers);
    return { SCALPING: new RadarEngine(cfg, "scalping", bm), INTRADAY: new RadarEngine(cfg, "intraday", bm) };
  }

  /** Terapkan settings: bangun ulang mesin lalu putar ulang trade sesi ini (snapshot orderbook lama tidak diputar ulang). */
  function apply(s: UserSettings): void {
    settings = s;
    cfg = s.thresholds as unknown as Thresholds;
    engines = makeEngines();
    for (const t of sessionTrades) {
      engines.SCALPING.ingestTrade(t, t.chgPct);
      engines.INTRADAY.ingestTrade(t, t.chgPct);
    }
    alerts = new AlertManager((s.thresholds.toast as ToastCfg) ?? { maxQueue: 3, cooldownSec: 60 });
    inst = new InstTraceTracker(instCfg());
    for (const t of sessionTrades) inst.add(t);
    live = new LiveTraceTracker(liveCfg());
    for (const t of sessionTrades) live.add(t);
    panel.showToasts([]);
  }

  function resetData(save = true): void {
    if (save) saveInst();
    engines = makeEngines();
    alerts.reset();
    inst = new InstTraceTracker(instCfg());
    live = new LiveTraceTracker(liveCfg());
    instSavedSig = "";
    liveSavedSig = "";
    sessionTrades.length = 0;
    recent.length = 0;
    tradeCount = 0;
    lastNewAt = null;
    ticks.clear();
    panel.showToasts([]);
    // tracker & dedup dipertahankan: baris lama yang masih tampil tidak dihitung ulang.
  }

  document.addEventListener("focusin", (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.matches(obSel.codeInput)) lastSearch = t;
  });

  panel.hooks = {
    onCodeClick: (code) => fillCodeSearch(document, obSel, code, lastSearch),
    onSave: (s) => {
      apply(s);
      try {
        chrome.storage?.local.set({ rbSettings: s });
      } catch { /* di luar ekstensi */ }
      return [];
    },
    onExport: (fmt) => {
      const name = `radar-bandar_${dayKey}`;
      if (fmt === "csv") download(`${name}.csv`, tradesToCSV(sessionTrades), "text/csv");
      else download(`${name}.jsonl`, tradesToJSONL(sessionTrades), "application/x-ndjson");
    },
    onReset: resetData,
    onSaveScanList: (codes) => {
      scanList = codes;
      store({ [SCAN_KEY]: codes });
    },
    onAutoRekap: () => void runAuto("final", true),
    onExportBackup: () => {
      try {
        chrome.storage?.local.get(null, (all) => {
          download(`radar-bandar-backup_${new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)}.json`, makeBackup(all ?? {}, Date.now()), "application/json");
        });
      } catch {
        panel.setHint("Export riwayat hanya bisa di dalam ekstensi");
      }
    },
    onImportBackup: (text) => {
      const b = parseBackup(text);
      if (b.error) return `Impor gagal: ${b.error}`;
      store(b.items);
      return `Impor berhasil: ${b.count} data riwayat${b.skipped ? `, ${b.skipped} dilewati` : ""}`;
    },
    onExportRekapPdf: () => {
      const r = report();
      download(`${reportName(r)}.pdf`, toBytes(rekapPdf(r, Date.now())) as Uint8Array<ArrayBuffer>, "application/pdf");
    },
    onExportRekap: () => {
      const r = report();
      download(`${reportName(r)}.csv`, `${rekapToCSV(r.rekap, r.totals, r.label)}\n${instRankCSV(r)}\n${liveInstCSV(r)}`, "text/csv");
    },
    getSettings: () => ({
      current: settings, defaults,
      info: { trades: sessionTrades.length, dayKey, phase: marketPhase(Date.now(), settings.thresholds.sessions as SessionCfg) },
    }),
  };

  // Broker Summary dari tab /symbol/KODE (ditulis oleh bootSymbol). Data > 7 hari dihapus.
  const bsMap = new Map<string, BsSummary>();
  const bsMaxAgeMs = () => Number((settings.thresholds.brokerSummary as { maxAgeHours?: number } | undefined)?.maxAgeHours ?? 24) * 3600e3;
  const bsList = (now: number) => {
    const black = new Set(settings.blacklist);
    return [...bsMap.values()]
      .filter((s) => !black.has(s.code) && now - s.capturedAt < bsMaxAgeMs())
      .sort((a, b) => b.capturedAt - a.capturedAt);
  };
  // Render ulang langsung: halaman orderbook bisa diam (bursa tutup) sehingga observer tidak berdetak.
  const pushBs = () => {
    const now = Date.now();
    panel.update({ bs: bsList(now), now, rekap: { ...rekapSrc }, rekapHist, tradingDay: tradingDay(), rekapMissing: rekapMissing(now), charts: chartList(), divCfg: divCfg(), scanList });
  };
  // REKAP (Movers Net Foreign + Broker Analysis), ditulis oleh pengumpul di halaman mana pun.
  const rekapSrc: { fb: ForeignSnap | null; fs: ForeignSnap | null; inst: InstSnap | null } = { fb: null, fs: null, inst: null };
  const setRekap = (k: string, v: unknown) => {
    const key = k.slice(REKAP_PREFIX.length);
    if (key === "fbuy") rekapSrc.fb = (v as ForeignSnap) ?? null;
    else if (key === "fsell") rekapSrc.fs = (v as ForeignSnap) ?? null;
    else if (key === "inst") rekapSrc.inst = (v as InstSnap) ?? null;
  };
  // Candle Chartbit per emiten (DIVERGENCE).
  const chartMap = new Map<string, ChartStore>();
  const chartList = () => [...chartMap.values()];
  let scanList: string[] = [];
  const divCfg = (): DivCfg => ({ ...DEFAULT_DIV, ...((settings.thresholds.divergence as Partial<DivCfg> | undefined) ?? {}) });
  // Riwayat per hari bursa / rentang untuk REKAP rentang tanggal.
  const rekapHist: RekapHistory = { fbuy: {}, fsell: {}, inst: {}, trace: {}, live: {} };
  /** Pengingat setelah bursa tutup bila REKAP hari bursa terakhir belum lengkap. */
  const rekapMissing = (now: number): string[] | null => {
    const sessions = settings.thresholds.sessions as SessionCfg;
    if (marketPhase(now, sessions) !== "TUTUP") return null;
    const { min, day } = wibClock(now);
    if (day >= 1 && day <= 5 && min >= 16 * 60 && min < 16 * 60 + 15) return null; // tunggu data final
    const m = completeness(rekapHist, lastTradingDate(now, sessions)).missing;
    return m.length ? m : null;
  };
  const tradingDay = () => lastTradingDate(Date.now(), settings.thresholds.sessions as SessionCfg);
  const report = () => makeReport(rekapSrc, rekapHist, panel.state.rekapRange, tradingDay());
  const reportName = (r: ReturnType<typeof report>) =>
    `radar-rekap_${r.from ? (r.from === r.to ? r.from : `${r.from}_sd_${r.to}`) : rekapSrc.fb?.day ?? rekapSrc.fs?.day ?? rekapSrc.inst?.day ?? dayKey}`;
  try {
    chrome.storage?.local.get(null, (all) => {
      const old: string[] = [];
      for (const [k, v] of Object.entries(all ?? {})) {
        if (k.startsWith(REKAP_PREFIX)) setRekap(k, v);
        if (k.startsWith(CHART_PREFIX) && v) chartMap.set(k, v as ChartStore);
        if (k === SCAN_KEY && Array.isArray(v)) scanList = normalizeScanList((v as string[]).join(" "));
        if (putHistory(rekapHist, k, v) && Date.now() - ((v as { capturedAt?: number; savedAt?: number })?.capturedAt ?? (v as { savedAt?: number })?.savedAt ?? 0) > 365 * 86400e3) old.push(k);
        if (!k.startsWith(BS_PREFIX)) continue;
        const s = v as BsSummary;
        if (Date.now() - s.capturedAt > 7 * 86400e3) old.push(k);
        else bsMap.set(s.code, s);
      }
      if (old.length) chrome.storage.local.remove(old);
      histLoaded = true;
      pushBs();
    });
    chrome.storage?.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      let hit = false;
      for (const [k, c] of Object.entries(changes)) {
        if (putHistory(rekapHist, k, c.newValue)) hit = true;
        if (k === SCAN_KEY) {
          scanList = Array.isArray(c.newValue) ? normalizeScanList((c.newValue as string[]).join(" ")) : [];
          hit = true;
        }
        if (k.startsWith(CHART_PREFIX)) {
          if (c.newValue) chartMap.set(k, c.newValue as ChartStore);
          else chartMap.delete(k);
          hit = true;
        }
        if (k.startsWith(REKAP_PREFIX)) {
          setRekap(k, c.newValue);
          hit = true;
        }
        if (!k.startsWith(BS_PREFIX)) continue;
        hit = true;
        if (c.newValue) bsMap.set((c.newValue as BsSummary).code, c.newValue as BsSummary);
        else bsMap.delete(k.slice(BS_PREFIX.length));
      }
      if (hit) pushBs();
    });
  } catch { /* di luar ekstensi */ }

  // AUTO REKAP: ambil Movers & Broker Analysis sendiri lewat iframe tersembunyi (lihat core/autoRekap.ts).
  const sessionsCfg = () => settings.thresholds.sessions as SessionCfg;
  const autoCfg = (): AutoRekapCfg => ({ ...DEFAULT_AUTO, ...((settings.thresholds.autoRekap as Partial<AutoRekapCfg> | undefined) ?? {}) });
  let autoState: AutoState = { ...EMPTY_AUTO_STATE };
  let autoRunning = false;
  const LOCK_KEY = "rbAutoLock";
  const hhmmNow = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(11, 16);
  const pushAuto = () => panel.update({ autoInfo: autoState.lastResult, autoCfg: autoCfg() });
  try {
    chrome.storage?.local.get(AUTO_KEY, (v) => {
      if (v?.[AUTO_KEY]) autoState = { ...EMPTY_AUTO_STATE, ...(v[AUTO_KEY] as AutoState) };
      pushAuto();
    });
    chrome.storage?.onChanged.addListener((ch, area) => {
      if (area === "local" && ch[AUTO_KEY]?.newValue) {
        autoState = { ...EMPTY_AUTO_STATE, ...(ch[AUTO_KEY].newValue as AutoState) };
        pushAuto();
      }
    });
  } catch { /* di luar ekstensi */ }
  /** Kunci antar-tab: hanya satu tab Stockbit yang menjalankan auto dalam 2 menit. */
  const takeLock = () =>
    new Promise<boolean>((resolve) => {
      try {
        chrome.storage.local.get(LOCK_KEY, (v) => {
          const t = Number(v?.[LOCK_KEY] ?? 0);
          if (Date.now() - t < 120_000) return resolve(false);
          chrome.storage.local.set({ [LOCK_KEY]: Date.now() }, () => resolve(true));
        });
      } catch {
        resolve(true);
      }
    });
  const runAuto = async (mode: AutoMode, manual = false) => {
    if (autoRunning) return;
    if (!(await takeLock())) {
      if (manual) panel.setHint("AUTO REKAP sedang berjalan di tab Stockbit lain");
      return;
    }
    autoRunning = true;
    const cfgA = autoCfg();
    let result = "";
    try {
      const r = await runAutoRekap(document, { brokers: cfgA.brokers, institusi: mode === "final" }, {
        step: (m) => panel.setHint(`AUTO REKAP: ${m}`),
        saveForeign: (k, rows) => saveForeignSnap(k, rows, Date.now()),
        saveInst: (p) => saveInstSnap(p, Date.now()),
      });
      const parts = [r.ok.length ? `berhasil: ${r.ok.join(", ")}` : "", r.failed.length ? `gagal: ${r.failed.join("; ")}` : ""].filter(Boolean);
      result = `${manual ? "manual" : mode === "final" ? "otomatis" : "intraday"} ${hhmmNow()} WIB — ${parts.join(" • ") || "tidak ada data"}`;
    } catch (e) {
      result = `${hhmmNow()} WIB — gagal: ${String(e)}`;
    } finally {
      autoState = markRun(autoState, Date.now(), mode, result);
      store({ [AUTO_KEY]: autoState, [LOCK_KEY]: 0 });
      autoRunning = false;
      panel.setHint(`AUTO REKAP ${result}`);
      setTimeout(() => panel.setHint(null), 8000);
      pushAuto();
    }
  };
  const autoTick = () => {
    if (autoRunning) return;
    const now = Date.now();
    const mode = decideAuto(now, sessionsCfg(), autoCfg(), autoState, completeness(rekapHist, lastTradingDate(now, sessionsCfg())).missing);
    if (mode) void runAuto(mode);
  };
  setTimeout(autoTick, 20_000);
  setInterval(autoTick, 60_000);

  try {
    chrome.storage?.local.get(["rbPos", "rbSettings"], (v) => {
      panel.restorePosition(v?.rbPos as { left?: string; top?: string } | undefined);
      if (v?.rbSettings) apply(loadSettings(v.rbSettings, defaults));
    });
  } catch { /* abaikan */ }

  startDomObserver(document, () => {
    if (panel.state.paused) return;
    const now = Date.now();
    const key = tradingDayKey(now, String(settings.thresholds.dailyResetWIB ?? "08:45"));
    if (key !== dayKey) {
      saveInst(); // simpan hari lama dengan kunci hari lama
      dayKey = key;
      resetData(false);
    }
    movers();
    const ob = parseOrderbookPage(document, obSel, now, obMemo);
    const snaps = new Map(ob.widgets.filter((w) => w.snapshot).map((w) => [w.code, w.snapshot!]));
    const rt = parseRunningTrade(document, rtSel);
    // F Buy / F Sell widget dicatat sebelum trade tick ini (patokan atribusi asing).
    for (const snap of snaps.values()) live.onForeign(snap.code, snap.ts, snap.foreignBuy, snap.foreignSell);
    const liveNew: LiveEvent[] = [];
    for (const snap of snaps.values()) {
      engines.SCALPING.ingestSnapshot(snap);
      engines.INTRADAY.ingestSnapshot(snap);
    }

    if (rt.found && rt.newestFirst) {
      for (const raw of tracker.ingest(rt.rows)) {
        if (!dedup.accept(raw.hash)) continue;
        let tick = ticks.get(raw.code);
        if (!tick) ticks.set(raw.code, (tick = {}));
        const t = toTrade(raw, now, snaps.get(raw.code), tick);
        tradeCount++;
        recent.unshift(t);
        sessionTrades.push({ ...t, chgPct: raw.chgPct });
        lastNewAt = now;
        engines.SCALPING.ingestTrade(t, raw.chgPct);
        engines.INTRADAY.ingestTrade(t, raw.chgPct);
        inst.add(t);
        const lv = live.add(t);
        if (lv) liveNew.push(lv);
      }
      recent.length = Math.min(recent.length, 10);
      if (sessionTrades.length > MAX_SESSION_TRADES) sessionTrades.splice(0, sessionTrades.length - MAX_SESSION_TRADES);
    }

    const rowsTotal = ob.rowsTotal + rt.rowsTotal;
    const rowsOk = ob.rowsOk + rt.rowsOk;
    const parserPct = rowsTotal ? Math.round((100 * rowsOk) / rowsTotal) : null;
    // Kedua mode dievaluasi tiap tick agar bintang & pergantian sisi tetap berjalan walau tab tidak aktif.
    const allViews = { SCALPING: engines.SCALPING.views(now, parserPct), INTRADAY: engines.INTRADAY.views(now, parserPct) };
    const mode = panel.state.mode;
    const watch = new Set(settings.watchlist);
    const black = new Set(settings.blacklist);
    const views = arrangeViews(allViews[mode], watch, black);

    const fresh = alerts.evaluate(views, now, (c) => !black.has(c) && (!settings.toastWatchlistOnly || watch.has(c)));
    for (const e of liveNew) {
      if (black.has(e.code) || (settings.toastWatchlistOnly && !watch.has(e.code))) continue;
      const tx = `${e.code}: POLA BESAR ${e.side} • ${e.category} • ${formatCompact(e.value)} (${e.trades} trade)`;
      const toast = alerts.notify(`${e.code}|${e.side}|live`, e.code, e.side === "BELI" ? "green" : "red", tx, now);
      if (toast) fresh.push(toast);
    }
    if (fresh.length && settings.sound) beep();
    panel.showToasts(alerts.queue);

    const fmtTime = (ts: number) => new Date(ts + 7 * 3600e3).toISOString().slice(11, 19);
    panel.update({
      parserPct,
      views,
      bigs: engines[mode].recentBig.filter((b) => !black.has(b.code)),
      now,
      phase: marketPhase(now, settings.thresholds.sessions as SessionCfg),
      watch: settings.watchlist,
      bs: bsList(now),
      rekap: { ...rekapSrc },
      rekapHist,
      tradingDay: tradingDay(),
      rekapMissing: rekapMissing(now),
      charts: chartList(),
      divCfg: divCfg(),
      scanList,
      obOk: ob.widgets.filter((w) => w.ok).length,
      obTotal: ob.widgets.length,
      bookRows: toBookRows(ob),
      trades: tradeCount,
      dup: dedup.dupCount,
      rtFreshSec: rt.found ? (lastNewAt ? Math.round((now - lastNewAt) / 1000) : 0) : null,
      brokerVisible: rt.brokerVisible,
      inst: { events: inst.events, nets: inst.nets(), cfg: instCfg(), live: { events: live.events, summary: live.summary(), cfg: liveCfg() } },
      recentTrades: recent.map<TradeRow>((t) => ({
        time: fmtTime(t.ts), code: t.code, price: t.price, lot: t.lot, value: t.value, side: t.side,
        buyer: t.buyerBroker ? `${t.buyerBroker}${t.buyerType ? ` [${t.buyerType}]` : ""}` : undefined,
        seller: t.sellerBroker ? `${t.sellerBroker}${t.sellerType ? ` [${t.sellerType}]` : ""}` : undefined,
        board: t.board,
      })),
    });
  }, 500, panel.host);
}

/** Penanda kecil di pojok kiri bawah (Shadow DOM, hilang sendiri) agar pengguna tahu data terbaca. */
function makeChip(id: string): { host: HTMLElement; show(text: string): void } {
  const host = document.createElement("div");
  host.id = id;
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>div{position:fixed;left:12px;bottom:12px;z-index:2147483646;background:#0f1d2b;color:#38bdf8;
    border:1px solid #1c2e40;border-radius:8px;padding:6px 10px;font:12px system-ui,sans-serif;opacity:0;transition:opacity .3s;pointer-events:none}
    div.on{opacity:.95}</style><div></div>`;
  document.documentElement.appendChild(host);
  const chip = root.querySelector("div")!;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  return {
    host,
    show(text: string) {
      chip.textContent = text;
      chip.classList.add("on");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => chip.classList.remove("on"), 5000);
    },
  };
}

const store = (items: Record<string, unknown>) => {
  try {
    chrome.storage?.local.set(items);
  } catch { /* di luar ekstensi */ }
};

/** Simpan asing (Movers) ke "terbaru" & riwayat hari bursa. Kembalikan hari bursa. */
function saveForeignSnap(kind: "buy" | "sell", rows: ForeignRow[], now: number): string {
  const day = lastTradingDate(now, thresholdsJson.sessions as unknown as SessionCfg);
  const snap: ForeignSnap = { kind, capturedAt: now, day, rows };
  const k = kind === "buy" ? "fbuy" : "fsell";
  store({ [`${REKAP_PREFIX}${k}`]: snap, [histKey(k, day)]: snap });
  return day;
}

/** Simpan institusi (Broker Analysis) ke riwayat (harian/rentang) & "terbaru" (bila satu hari). */
function saveInstSnap(p: BrokerAnalysisParse, now: number): void {
  const { found: _f, rowsTotal: _t, rowsOk: _o, ...rest } = p;
  const range = parseDateRange(p.dateText);
  const snap: InstSnap = { capturedAt: now, day: range?.to ?? null, ...rest };
  const items: Record<string, unknown> = {};
  if (range) items[histKey("inst", range.from, range.to)] = snap;
  if (!range || range.from === range.to) items[`${REKAP_PREFIX}inst`] = snap;
  store(items);
}

/**
 * Panel Movers (ikon api) tab Net Foreign Buy/Sell -> "rbRekap:fbuy|fsell" (terbaru) dan riwayat per hari bursa.
 * Dipanggil tiap tick; menulis hanya bila isi berubah DAN sudah stabil (dicek ulang 1,2 dtk kemudian,
 * karena saat bursa tutup halaman diam dan tick berikutnya belum tentu datang).
 */
function makeMoversCollector(onNew: (msg: string) => void): () => void {
  const last: Record<string, string> = {};
  let pending = "";
  const run = () => {
    const m = parseMoversForeign(document);
    if (!m.kind || m.rowsOk === 0) return;
    const sig = `${m.kind}|${JSON.stringify(m.rows)}`;
    if (sig !== pending) {
      pending = sig;
      setTimeout(run, 1200);
      return;
    }
    if (last[m.kind] === sig) return;
    last[m.kind] = sig;
    const day = saveForeignSnap(m.kind, m.rows, Date.now());
    onNew(`Radar: Net Foreign ${m.kind === "buy" ? "Buy" : "Sell"} ${day} terbaca (${m.rowsOk} emiten) untuk REKAP`);
  };
  return run;
}

/**
 * Mode halaman emiten (stockbit.com/symbol/KODE): tanpa panel radar. Membaca widget Broker Summary
 * (dan panel Movers bila dibuka), meringkas, dan menyimpannya lokal untuk panel orderbook.
 */
function bootSymbol(): void {
  const sel = selectors.brokerSummary as unknown as BrokerSummarySelectors;
  let cfg: BsConfig = thresholdsJson.brokerSummary;
  try {
    chrome.storage?.local.get("rbSettings", (v) => {
      const c = (v?.rbSettings as UserSettings | undefined)?.thresholds?.brokerSummary as Partial<BsConfig> | undefined;
      if (c) cfg = { ...cfg, ...c };
    });
  } catch { /* abaikan */ }

  const chip = makeChip("radar-bandar-idx-bs");
  const movers = makeMoversCollector((msg) => chip.show(msg));
  const last = new Map<string, BsSummary>();

  // Chartbit Table view: TradingView ada di iframe, perubahannya tidak tertangkap observer halaman -> cek tiap 2 dtk.
  const chartCache = new Map<string, ChartStore>();
  const loading = new Set<string>();
  // Progres Daftar Pindai untuk penanda di Chartbit.
  let scan: string[] = [];
  const known = new Map<string, ChartStore>();
  try {
    chrome.storage?.local.get(null, (all) => {
      for (const [k, v] of Object.entries(all ?? {})) {
        if (k === SCAN_KEY && Array.isArray(v)) scan = normalizeScanList((v as string[]).join(" "));
        if (k.startsWith(CHART_PREFIX) && v) known.set(k, v as ChartStore);
      }
    });
    chrome.storage?.onChanged.addListener((ch, area) => {
      if (area === "local" && ch[SCAN_KEY]) scan = Array.isArray(ch[SCAN_KEY].newValue) ? (ch[SCAN_KEY].newValue as string[]) : [];
    });
  } catch { /* di luar ekstensi */ }
  const scanNote = (code: string) => {
    if (!scan.length) return "";
    const day = lastTradingDate(Date.now(), thresholdsJson.sessions as unknown as SessionCfg);
    const pr = scanProgress(scan, [...known.values()], day);
    const inList = scan.includes(code) ? "" : " (di luar daftar)";
    return ` • daftar pindai ${pr.done.length}/${scan.length}${inList}${pr.next ? ` • berikutnya: ${pr.next}` : " • daftar selesai"}`;
  };
  let chartPending = "";
  let lastShown = "";
  const checkChart = () => {
    const p = parseChartTable(document);
    if (!p.found || !p.symbol || !p.rowsOk) return;
    const tf = p.timeframe ?? "?";
    const sig = `${p.symbol}|${tf}|${JSON.stringify(p.bars)}`;
    if (sig !== chartPending) {
      chartPending = sig; // tunggu isi stabil (tabel bisa sedang berganti simbol)
      return;
    }
    const key = chartKey(p.symbol, tf);
    const merge = (prev: ChartStore | undefined) => {
      const m = mergeBars(prev, p.symbol!, tf, p.bars, Date.now());
      const cur = m ?? prev;
      if (cur) chartCache.set(key, cur);
      if (m) {
        known.set(key, m);
        store({ [key]: m });
      }
      // Tampilkan penanda saat data baru ATAU saat pengguna pindah ke emiten lain (agar terlihat kode berikutnya).
      if (cur && (m || key !== lastShown)) {
        lastShown = key;
        chip.show(`Radar: Chartbit ${p.symbol} ${tf} ${m ? "terbaca" : "sudah tersimpan"}, ${cur.bars.length} candle${scanNote(p.symbol!)}`);
      }
    };
    if (chartCache.has(key)) return merge(chartCache.get(key));
    if (loading.has(key)) return;
    loading.add(key);
    try {
      chrome.storage.local.get(key, (v) => {
        loading.delete(key);
        merge(v?.[key] as ChartStore | undefined);
      });
    } catch {
      loading.delete(key);
      merge(undefined);
    }
  };
  setInterval(checkChart, 2000);

  startDomObserver(document, () => {
    const now = Date.now();
    movers();
    const code = symbolFromPath(location.pathname);
    if (!code) return;
    const p = parseBrokerSummary(document, sel);
    if (!p.found || p.rowsOk === 0) return;
    const s = summarizeBrokerSummary(code, p, now, cfg);
    if (sameSummary(last.get(code), s)) return;
    last.set(code, s);
    store({ [`${BS_PREFIX}${code}`]: s });
    chip.show(`Radar: Broker Summary ${code} ${s.dateText ?? ""} terbaca (${s.rows} baris${p.errors.length ? `, ${p.errors.length} gagal` : ""})`);
  }, 1000, chip.host);
}

/**
 * Mode Broker Analysis (stockbit.com/broker-analysis/...): baca Top Buy/Top Sell broker yang dipilih
 * pengguna -> "rbRekap:inst". Radar tidak memilih broker dan tidak mengubah filter.
 */
function bootBrokerAnalysis(): void {
  const chip = makeChip("radar-bandar-idx-ba");
  let lastSig = "";
  let pendingSig = "";
  const check = () => {
    const p = parseBrokerAnalysis(document);
    if (!p.found || p.rowsOk === 0 || !p.brokers.length) return;
    const { found: _f, rowsTotal: _t, rowsOk: _o, ...rest } = p;
    const sig = JSON.stringify(rest);
    // Tanggal & tabel berganti tidak bersamaan saat pengguna memilih tanggal: tunggu isi stabil 2 tick.
    if (sig !== pendingSig) {
      pendingSig = sig;
      setTimeout(check, 1200);
      return;
    }
    if (sig === lastSig) return;
    lastSig = sig;
    void rest;
    saveInstSnap(p, Date.now());
    chip.show(`Radar: Broker Analysis ${p.brokers.map((b) => b.code).join(",")} ${p.dateText ?? ""} terbaca (${p.buys.length}+${p.sells.length} emiten)${p.bothSides.length ? " • cek sakelar Net" : ""}`);
  };
  startDomObserver(document, check, 1000, chip.host);
}

if (symbolFromPath(location.pathname)) bootSymbol();
else if (location.pathname.startsWith("/broker-analysis")) bootBrokerAnalysis();
else boot();
