/**
 * AUTO REKAP lewat iframe tersembunyi (origin sama) di halaman Stockbit yang sedang terbuka.
 * Langkah (dicek live 2026-11-16):
 *  1. iframe -> /broker-analysis/broker
 *  2. institusi: mousedown pada .ant-select-selector milik pemilih broker (yang berisi chip span[type]) -> dropdown terbuka ->
 *     klik grup "Recent Selected Broker" (span berisi span[type] kode) bila kodenya sama dengan daftar broker pilihan.
 *  3. asing: klik [data-cy=right-menu-movers] -> tab #MOVER_TYPE_NET_FOREIGN_BUY lalu #..._SELL.
 *  4. iframe dihapus. Tidak ada API, tidak ada data dikirim keluar, tidak ada order.
 */
import { sameSet } from "../core/autoRekap";
import { parseBrokerAnalysis, parseMoversForeign, type BrokerAnalysisParse, type ForeignRow } from "./parse-rekap";

export interface RunnerHooks {
  step(msg: string): void;
  saveForeign(kind: "buy" | "sell", rows: ForeignRow[]): void;
  saveInst(p: BrokerAnalysisParse): void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tunggu sampai fn() mengembalikan nilai bukan-null, cek tiap 500 ms. */
async function waitFor<T>(fn: () => T | null | undefined, timeoutMs: number): Promise<T | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const v = fn();
      if (v) return v;
    } catch { /* halaman masih memuat */ }
    await sleep(500);
  }
  return null;
}

/** Tunggu isi stabil: dua pembacaan berurutan (selang 1,2 dtk) sama persis. */
async function waitStable<T>(fn: () => T | null, timeoutMs: number): Promise<T | null> {
  const end = Date.now() + timeoutMs;
  let prev = "";
  while (Date.now() < end) {
    const v = fn();
    const sig = v ? JSON.stringify(v) : "";
    if (v && sig === prev) return v;
    prev = sig;
    await sleep(1200);
  }
  return null;
}

const click = (d: Document, el: Element, type = "click") =>
  el.dispatchEvent(new (d.defaultView as Window & typeof globalThis).MouseEvent(type, { bubbles: true, cancelable: true, view: d.defaultView, button: 0 }));

/** Pilih set broker lewat "Recent Selected Broker". Kembalikan pesan gagal atau null bila berhasil/sudah sesuai. */
async function selectBrokers(d: Document, want: string[]): Promise<string | null> {
  const cur = parseBrokerAnalysis(d).brokers.map((b) => b.code);
  if (sameSet(cur, want)) return null;
  const chip = [...d.querySelectorAll("span[type]")].find((s) => /^[A-Z0-9]{2}$/.test((s.textContent ?? "").trim()) && s.closest(".ant-select"));
  const selector = chip?.closest(".ant-select")?.querySelector(".ant-select-selector");
  if (!selector) return "pemilih broker tidak ditemukan";
  click(d, selector, "mousedown");
  const group = await waitFor(() => {
    const lab = [...d.querySelectorAll("span")].find((s) => (s.textContent ?? "").trim() === "Recent Selected Broker");
    return lab?.parentElement?.nextElementSibling ?? null;
  }, 4000);
  if (!group) return "daftar Recent Selected Broker tidak muncul";
  const chips = [...group.querySelectorAll("span[type]")];
  const codes = chips.map((s) => (s.textContent ?? "").trim());
  if (!sameSet(codes, want)) return `Recent Selected Broker (${codes.join(",") || "-"}) berbeda dari daftar ${want.join(",")}: pilih broker itu sekali secara manual di Broker Analysis`;
  click(d, chips[0]!.parentElement!);
  const ok = await waitFor(() => (sameSet(parseBrokerAnalysis(d).brokers.map((b) => b.code), want) ? true : null), 8000);
  return ok ? null : "pilihan broker tidak berubah";
}

export async function runAutoRekap(host: Document, opts: { brokers: string[]; institusi: boolean }, hooks: RunnerHooks): Promise<{ ok: string[]; failed: string[] }> {
  const ok: string[] = [];
  const failed: string[] = [];
  const f = host.createElement("iframe");
  f.id = "radar-bandar-idx-auto";
  f.setAttribute("aria-hidden", "true");
  f.style.cssText = "position:fixed;left:0;top:0;width:1400px;height:900px;opacity:0;pointer-events:none;z-index:-1;border:0;";
  f.src = "/broker-analysis/broker";
  host.body.appendChild(f);
  try {
    hooks.step("memuat Stockbit di latar…");
    const d = await waitFor(() => {
      const doc = f.contentDocument;
      return doc && parseBrokerAnalysis(doc).found ? doc : null;
    }, 30000);
    if (!d) {
      failed.push("halaman Broker Analysis tidak termuat");
      return { ok, failed };
    }

    if (opts.institusi) {
      hooks.step("institusi: memilih broker…");
      const err = await selectBrokers(d, opts.brokers);
      if (err) failed.push(`institusi: ${err}`);
      else {
        const p = await waitStable(() => {
          const x = parseBrokerAnalysis(d);
          return x.found && x.rowsOk > 0 && sameSet(x.brokers.map((b) => b.code), opts.brokers) ? x : null;
        }, 15000);
        if (p) {
          hooks.saveInst(p);
          ok.push("institusi");
        } else failed.push("institusi: tabel tidak stabil");
      }
    }

    hooks.step("asing: membuka Movers…");
    const menu = d.querySelector("[data-cy=right-menu-movers]");
    if (!menu) {
      failed.push("asing: ikon Movers tidak ditemukan");
      return { ok, failed };
    }
    click(d, menu.firstElementChild ?? menu);
    for (const kind of ["buy", "sell"] as const) {
      const tab = await waitFor(() => d.querySelector(`[id^=MOVER_TYPE_NET_FOREIGN_${kind === "buy" ? "BUY" : "SELL"}]`), 8000);
      if (!tab) {
        failed.push(`asing ${kind === "buy" ? "beli" : "jual"}: tab tidak ditemukan`);
        continue;
      }
      click(d, tab);
      const m = await waitStable(() => {
        const x = parseMoversForeign(d);
        return x.kind === kind && x.rowsOk > 0 ? x.rows : null;
      }, 15000);
      if (m) {
        hooks.saveForeign(kind, m);
        ok.push(kind === "buy" ? "asing beli" : "asing jual");
      } else failed.push(`asing ${kind === "buy" ? "beli" : "jual"}: tabel tidak stabil`);
    }
    // Rapikan jejak UI (Stockbit bisa mengingat panel/tab terakhir): kembali ke Top Gainer lalu tutup panel Movers.
    const tg = d.querySelector("[id^=MOVER_TYPE_TOP_GAINER]");
    if (tg) click(d, tg);
    await sleep(500);
    click(d, menu.firstElementChild ?? menu);
    await sleep(500);
    return { ok, failed };
  } finally {
    f.remove();
  }
}
