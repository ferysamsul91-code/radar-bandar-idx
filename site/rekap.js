/**
 * REKAP harian di landing page. Data di data/days/*.enc.json dikirim ekstensi pemilik halaman dalam keadaan
 * TERENKRIPSI (format sama dengan src/core/seal.ts) dan dibuka di browser ini dengan kata sandi data.
 * Kata sandi tidak dikirim ke mana pun. Bukan rekomendasi beli/jual.
 */
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const through = async (data, t) => new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(t)).arrayBuffer());

export async function openSealed(env, pass) {
  if (!env || env.v !== 1 || env.alg !== "AES-GCM" || env.kdf !== "PBKDF2-SHA256") throw new Error("format data tidak dikenal");
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: unb64(env.salt), iterations: env.iter }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
  );
  let body;
  try {
    body = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(env.iv), additionalData: new TextEncoder().encode(`${env.kind}|${env.day}`) }, key, unb64(env.ct),
    ));
  } catch {
    throw new Error("kata sandi salah atau data rusak");
  }
  const plain = env.z === "gzip" ? await through(body, new DecompressionStream("gzip")) : body;
  return JSON.parse(new TextDecoder().decode(plain));
}

// ---------- format ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const fmtNum = (n, d = 0) => (n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d }));
export function fmtRp(n, signed = true) {
  if (n == null) return "—";
  const a = Math.abs(n);
  const s = n < 0 ? "-" : signed && n > 0 ? "+" : "";
  const f = (x) => x.toLocaleString("id-ID", { maximumFractionDigits: 2 });
  if (a >= 1e12) return `${s}${f(a / 1e12)}T`;
  if (a >= 1e9) return `${s}${f(a / 1e9)}B`;
  if (a >= 1e6) return `${s}${f(a / 1e6)}M`;
  if (a >= 1e3) return `${s}${f(a / 1e3)}K`;
  return `${s}${f(a)}`;
}
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const fmtDay = (d) => (d ? `${Number(d.slice(8, 10))} ${BULAN[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : "?");
const wib = (t) => {
  const d = new Date(t + 7 * 3600e3);
  return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${d.toISOString().slice(11, 16)} WIB`;
};
const sgn = (n) => (n == null ? "" : n > 0 ? "up" : n < 0 ? "down" : "");
const pct = (n) => (n == null ? "—" : `${n > 0 ? "+" : ""}${fmtNum(n, 2)}%`);

// ---------- render ----------
function instTable(title, rows, sec, buy) {
  const hari = sec.dataDays != null && sec.from !== sec.to;
  const total = buy ? sec.totals.instBuy : -sec.totals.instSell;
  if (!rows.length) return `<h3>${title} <small>(0)</small></h3><p class="muted">Tidak ada data institusi.</p>`;
  const body = rows.map((r) => `<tr><td class="n">${r.rank}</td><td class="code">${esc(r.code)}</td>
    <td class="${sgn(r.inst)}"><b>${fmtRp(r.inst)}</b></td><td>${fmtNum(r.share * 100, 1)}%</td><td>${fmtNum(r.avg)}</td>
    ${hari ? `<td>${r.days}/${sec.dataDays}</td>` : ""}
    <td class="${sgn(r.foreign)}">${r.foreign == null ? "—" : `${fmtRp(r.foreign)} <small>${(r.foreign > 0) === buy ? "searah" : "lawan"}</small>`}</td>
    <td>${fmtNum(r.price)}</td><td class="${sgn(r.chgPct)}">${pct(r.chgPct)}</td></tr>`).join("");
  return `<h3>${title} <small>(${rows.length} emiten • total ${fmtRp(total, false)})</small></h3>
    <div class="rk-tbl"><table><thead><tr><th>#</th><th class="l">KODE</th><th>INST NET</th><th>PORSI</th><th>AVG INST</th>${hari ? `<th>HARI ${buy ? "BELI" : "JUAL"}</th>` : ""}<th>ASING NET</th><th>HARGA</th><th>CHG</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}
function foreignTable(title, rows, sec, buy) {
  const total = buy ? sec.totals.foreignBuy : -sec.totals.foreignSell;
  if (!rows.length) return `<h3>${title} <small>(0)</small></h3><p class="muted">Tidak ada data asing.</p>`;
  const body = rows.map((r, i) => `<tr><td class="n">${i + 1}</td><td class="code">${esc(r.code)}</td>
    <td class="${sgn(r.foreign)}"><b>${fmtRp(r.foreign)}</b></td><td class="${sgn(r.inst)}">${fmtRp(r.inst)}</td>
    <td>${fmtNum(r.price)}</td><td class="${sgn(r.chgPct)}">${pct(r.chgPct)}</td></tr>`).join("");
  return `<h3>${title} <small>(${rows.length} emiten • total ${fmtRp(total, false)})</small></h3>
    <div class="rk-tbl"><table><thead><tr><th>#</th><th class="l">KODE</th><th>ASING NET</th><th>INST NET</th><th>HARGA</th><th>CHG</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}
function liveTable(sec) {
  if (!sec.liveInst?.length) return "";
  const body = sec.liveInst.map((r) => `<tr><td class="code">${esc(r.code)}</td><td class="up">${fmtRp(r.instBuy)}</td>
    <td class="down">${r.instSell ? fmtRp(-r.instSell) : "—"}</td><td class="up"><b>${fmtRp(r.net)}</b></td><td>${r.instRuns}</td>
    <td>${r.ba == null ? '<span class="muted">tidak di daftar</span>' : r.ba > 0 ? `<span class="up">searah ${fmtRp(r.ba)}</span>` : `<span class="down">berlawanan ${fmtRp(r.ba)}</span>`}</td></tr>`).join("");
  return `<h3>DETEKSI INSTITUSI BELI <small>(pola lot besar live • ${sec.liveDays}/${sec.liveDayCount} hari)</small></h3>
    <div class="rk-tbl"><table><thead><tr><th class="l">KODE</th><th>INST BELI</th><th>INST JUAL</th><th>NET</th><th>RANGKAIAN</th><th>BROKER ANALYSIS</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

/** HTML ringkasan satu bagian ("today" | "d5") dari payload hasil dekripsi. */
export function renderPayload(p, view = "today") {
  const sec = view === "d5" ? p.d5 : p.today;
  const t = sec.totals;
  const box = (label, v, cls) => `<div class="rk-box"><div>${label}</div><b class="${cls}">${fmtRp(v, false)}</b></div>`;
  const fDays = sec.coverage?.filter((c) => c.foreign).length ?? 0;
  const iDays = sec.coverage?.filter((c) => c.inst).length ?? 0;
  const cov = sec.coverage?.length > 1 ? ` • data asing ${fDays}/${sec.coverage.length} hari, institusi ${iDays}/${sec.coverage.length} hari` : "";
  return `<p class="rk-src"><b>${esc(sec.label)}</b> • broker institusi: ${esc(p.brokers.join(", ") || "—")} • ${esc(sec.instSource || "—")}${cov}</p>
    <div class="rk-tots">${box("Institusi total net beli", t.instBuy, "up")}${box("Institusi total net jual", t.instSell, "down")}${box("Asing total net beli", t.foreignBuy, "up")}${box("Asing total net jual", t.foreignSell, "down")}</div>
    ${instTable("DAFTAR TOTAL INSTITUSI NET BELI", sec.instBuy, sec, true)}
    ${instTable("DAFTAR TOTAL INSTITUSI NET JUAL", sec.instSell, sec, false)}
    ${foreignTable("ASING NET BELI", sec.foreignBuy, sec, true)}
    ${foreignTable("ASING NET JUAL", sec.foreignSell, sec, false)}
    ${liveTable(sec)}
    <p class="muted rk-note">Institusi = net gabungan broker pilihan pemilik di Broker Analysis Stockbit (ESTIMASI). Asing = Net Foreign Buy/Sell Stockbit (top 50 per hari).
      Dikirim ekstensi Radar Bandar IDX v${esc(p.version)} • dibuat ${wib(p.generatedAt)}. Bukan rekomendasi beli/jual.</p>`;
}

// ---------- halaman ----------
const PASS_KEY = "rbRekapPass";
const store = {
  get: () => { try { return localStorage.getItem(PASS_KEY) || ""; } catch { return ""; } },
  set: (v) => { try { v ? localStorage.setItem(PASS_KEY, v) : localStorage.removeItem(PASS_KEY); } catch { /* mode privat */ } },
};

export async function init(root) {
  let index;
  try {
    const r = await fetch(`data/index.json?t=${Date.now()}`, { cache: "no-store" });
    index = r.ok ? await r.json() : null;
  } catch { index = null; }
  if (!index?.days?.length) {
    root.innerHTML = `<p class="muted">Belum ada data REKAP yang dipublikasikan. Aktifkan <b>Publikasi online</b> di pengaturan ekstensi; data muncul di sini setelah penutupan hari bursa berikutnya.</p>`;
    return;
  }
  const latest = index.days[0];
  root.innerHTML = `<p class="rk-meta">Data terbaru: <b>${fmtDay(latest.day)}</b> • diperbarui ${wib(latest.updatedAt)} • ${index.days.length} hari tersimpan</p>
    <form class="rk-form" autocomplete="off">
      <select class="rk-day" aria-label="Hari bursa">${index.days.map((d) => `<option value="${esc(d.day)}">${fmtDay(d.day)}</option>`).join("")}</select>
      <input class="rk-pass" type="password" placeholder="Kata sandi data" aria-label="Kata sandi data" autocomplete="current-password">
      <button class="btn primary" type="submit">Buka</button>
      <label class="rk-rem"><input type="checkbox" class="rk-remember"> Ingat di perangkat ini</label>
    </form>
    <div class="rk-msg muted"></div>
    <div class="rk-view" hidden><div class="rk-tabs"><button type="button" data-v="today" class="on">Hari ini</button><button type="button" data-v="d5">5 hari bursa</button></div><div class="rk-body"></div></div>`;
  const $ = (s) => root.querySelector(s);
  const pass = $(".rk-pass");
  const remember = $(".rk-remember");
  const msg = $(".rk-msg");
  let payload = null;
  let view = "today";
  const show = () => {
    $(".rk-body").innerHTML = renderPayload(payload, view);
    root.querySelectorAll(".rk-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.v === view));
  };
  const open = async () => {
    const day = $(".rk-day").value;
    msg.textContent = "Membuka…";
    try {
      const r = await fetch(`data/days/${encodeURIComponent(day)}.enc.json?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`file ${day} tidak ditemukan`);
      payload = await openSealed(await r.json(), pass.value);
      store.set(remember.checked ? pass.value : "");
      msg.textContent = "";
      $(".rk-view").hidden = false;
      show();
    } catch (e) {
      msg.textContent = e instanceof Error ? e.message : String(e);
      $(".rk-view").hidden = true;
    }
  };
  $(".rk-form").addEventListener("submit", (e) => {
    e.preventDefault();
    void open();
  });
  $(".rk-day").addEventListener("change", () => pass.value && void open());
  root.querySelectorAll(".rk-tabs button").forEach((b) => b.addEventListener("click", () => {
    view = b.dataset.v;
    show();
  }));
  const saved = store.get();
  if (saved) {
    pass.value = saved;
    remember.checked = true;
    void open();
  }
}

if (typeof document !== "undefined") {
  const root = document.getElementById("rekap");
  if (root) void init(root);
}
