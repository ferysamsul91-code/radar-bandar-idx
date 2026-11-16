/** Form Settings di dalam panel (Shadow DOM). Tidak ada data yang dikirim ke luar. */
import { BROKER_CATS, brokerRows, mergeChecked, parseCodeList, rowsToBrokerTable, type BrokerCat, type UserSettings } from "../core/settings";
import { esc } from "./views";

export interface SettingsInfo {
  trades: number;
  dayKey: string;
  phase: string;
}

const catOpts = (sel: BrokerCat) => BROKER_CATS.map((c) => `<option value="${c}"${c === sel ? " selected" : ""}>${c}</option>`).join("");

export function brokerRowHtml(code = "", cat: BrokerCat = "RETAIL_HEAVY", name = ""): string {
  return `<tr class="br"><td><input class="b-code" maxlength="2" value="${esc(code)}" style="width:36px"></td>
    <td><select class="b-cat">${catOpts(cat)}</select></td>
    <td class="l"><input class="b-name" value="${esc(name)}" style="width:100%"></td>
    <td><button data-sact="delrow" title="Hapus baris">✕</button></td></tr>`;
}

export function settingsHtml(s: UserSettings, info: SettingsInfo, errors: string[], saved: boolean): string {
  const thr = JSON.stringify(s.thresholds, null, 2);
  const rows = brokerRows(s.brokers).map((r) => brokerRowHtml(r.code, r.cat, r.name)).join("");
  return `
  <div class="set">
    <div class="set-hdr"><b>SETTINGS</b><span class="sp"></span>
      <button data-sact="save" class="on">SIMPAN</button>
      <button data-sact="defaults" title="Kembalikan semua ke bawaan">BAWAAN</button>
      <button data-sact="close">TUTUP</button></div>
    ${errors.length ? `<div class="err">${errors.map(esc).join("<br>")}</div>` : saved ? `<div class="ok">Tersimpan. Mesin dihitung ulang dari ${info.trades.toLocaleString("id-ID")} trade sesi ini.</div>` : ""}
    <p class="note">Data radar tetap berjalan di belakang selama Settings terbuka. Semua tersimpan lokal (chrome.storage.local).</p>

    <h4>Emiten</h4>
    <label>Watchlist (pisah koma/spasi; diberi tanda W dan ditaruh paling atas)
      <input class="f-watch" value="${esc(s.watchlist.join(", "))}"></label>
    <label>Blacklist (disembunyikan dan tidak memicu toast)
      <input class="f-black" value="${esc(s.blacklist.join(", "))}"></label>

    <h4>Toast</h4>
    <label class="chk"><input type="checkbox" class="f-sound"${s.sound ? " checked" : ""}> Bunyi saat toast muncul</label>
    <label class="chk"><input type="checkbox" class="f-wonly"${s.toastWatchlistOnly ? " checked" : ""}> Toast hanya untuk watchlist</label>

    <h4>Data</h4>
    <div class="row">
      <button data-sact="csv">EXPORT CSV</button>
      <button data-sact="jsonl">EXPORT JSONL</button>
      <button data-sact="reset">RESET DATA SEKARANG</button>
      <span class="note">Sesi ${esc(info.dayKey)} • ${esc(info.phase)} • ${info.trades.toLocaleString("id-ID")} trade. Reset otomatis tiap hari jam ${esc(String(s.thresholds.dailyResetWIB ?? "08:45"))} WIB.</span>
    </div>

    <h4>WebSocket tap (opsi lanjutan)</h4>
    <label class="chk muted"><input type="checkbox" class="f-ws" disabled> Baca pesan WebSocket yang sudah diterima halaman (pasif)</label>
    <p class="note warn">Belum tersedia: format pesan WebSocket Stockbit belum diketahui, jadi opsi ini dikunci OFF.
      Membaca WebSocket juga lebih berisiko terhadap Ketentuan Layanan Stockbit dibanding membaca layar.</p>

    <h4>Tabel broker (brokers.json, belum diverifikasi)</h4>
    <table class="btab"><thead><tr><th class="l">KODE</th><th class="l">KATEGORI</th><th class="l">NAMA</th><th></th></tr></thead>
      <tbody class="b-body">${rows}</tbody></table>
    <button data-sact="addrow">+ BARIS</button>

    <h4>Ambang (thresholds.json, termasuk jam sesi)</h4>
    <p class="note">Hanya kunci yang sudah ada yang diterima; tipe harus sama. Kunci "_note" diabaikan.</p>
    <textarea class="f-thr" spellcheck="false">${esc(thr)}</textarea>
  </div>`;
}

/** Baca form. Kembalikan settings baru atau daftar error (tidak ada yang disimpan bila error). */
export function readSettingsForm(root: ParentNode, prev: UserSettings, defaults: UserSettings): { settings: UserSettings | null; errors: string[] } {
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel);
  const errors: string[] = [];
  let thresholds = prev.thresholds;
  const raw = q<HTMLTextAreaElement>(".f-thr")?.value ?? "";
  try {
    const parsed = JSON.parse(raw) as unknown;
    const r = mergeChecked(defaults.thresholds, parsed);
    errors.push(...r.errors);
    thresholds = r.value as Record<string, unknown>;
  } catch (e) {
    errors.push(`Ambang: JSON tidak valid (${(e as Error).message})`);
  }
  const rows = [...root.querySelectorAll<HTMLTableRowElement>("tr.br")].map((tr) => ({
    code: tr.querySelector<HTMLInputElement>(".b-code")?.value ?? "",
    cat: (tr.querySelector<HTMLSelectElement>(".b-cat")?.value ?? "RETAIL_HEAVY") as BrokerCat,
    name: tr.querySelector<HTMLInputElement>(".b-name")?.value ?? "",
  }));
  const bad = rows.filter((r) => r.code.trim() && !/^[A-Za-z0-9]{2}$/.test(r.code.trim()));
  if (bad.length) errors.push(`Kode broker harus 2 karakter: ${bad.map((r) => r.code).join(", ")}`);
  if (errors.length) return { settings: null, errors };
  return {
    errors,
    settings: {
      thresholds,
      brokers: rowsToBrokerTable(rows, String(defaults.brokers._note ?? "")),
      watchlist: parseCodeList(q<HTMLInputElement>(".f-watch")?.value ?? ""),
      blacklist: parseCodeList(q<HTMLInputElement>(".f-black")?.value ?? ""),
      sound: q<HTMLInputElement>(".f-sound")?.checked ?? false,
      toastWatchlistOnly: q<HTMLInputElement>(".f-wonly")?.checked ?? false,
      wsTap: false,
    },
  };
}

export const SETTINGS_CSS = `
.set h4 { margin:14px 0 6px; color:var(--cyan); font-size:11.5px; }
.set-hdr { display:flex; gap:6px; align-items:center; }
.set label { display:block; margin:6px 0; color:var(--muted); font-size:11px; }
.set label.chk { display:flex; gap:6px; align-items:center; color:var(--text); }
.set input:not([type=checkbox]), .set select, .set textarea { display:block; width:100%; box-sizing:border-box; margin-top:3px;
  background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:5px; padding:4px 6px; font:inherit; }
.set td input, .set td select { display:inline-block; width:auto; margin:0; }
.set textarea { height:260px; font:11px/1.35 ui-monospace, Consolas, monospace; }
.set .row { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.set .err { color:var(--red); margin-top:8px; font-size:11px; }
.set .ok { color:var(--green); margin-top:8px; font-size:11px; }
.btab td { padding:2px 4px; text-align:left; }
.btab td:last-child { text-align:right; }
.toasts { position:fixed; z-index:2147483647; display:flex; flex-direction:column; gap:6px; width:360px; pointer-events:none;
  font: 12px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.toast { pointer-events:auto; cursor:pointer; padding:8px 12px; border-radius:8px; font-weight:700; color:#e6edf3;
  background:#0f1d2b; border:1px solid #1c2e40; box-shadow:0 8px 20px rgba(0,0,0,.4); }
.toast.green { border-left:4px solid #2ecc71; color:#2ecc71; }
.toast.red { border-left:4px solid #e5484d; color:#e5484d; }
.toast.orange { border-left:4px solid #f59e0b; color:#f59e0b; }
`;
