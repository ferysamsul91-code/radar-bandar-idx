/** Halaman pengaturan PUBLIKASI ONLINE (chrome-extension://…/options.html). Token & kata sandi hanya diisi di sini. */
import { testConnection } from "../core/githubPublish";
import { PUB_CFG_KEY, PUB_ON_KEY, PUB_STATE_KEY, validatePublishCfg, type PublishCfg, type PublishState } from "../core/publish";
import { MIN_PASS } from "../core/seal";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const on = $<HTMLInputElement>("on");
const repo = $<HTMLInputElement>("repo");
const branch = $<HTMLInputElement>("branch");
const token = $<HTMLInputElement>("token");
const pass = $<HTMLInputElement>("pass");
const pass2 = $<HTMLInputElement>("pass2");
const msg = $<HTMLDivElement>("msg");
let saved: Partial<PublishCfg> = {};

const say = (text: string, ok: boolean | null = null) => {
  msg.textContent = text;
  msg.className = ok === null ? "" : ok ? "ok" : "bad";
};
const wib = (t: number) => new Date(t + 7 * 3600e3).toISOString().slice(0, 16).replace("T", " ") + " WIB";
const showState = (st: PublishState | undefined) => {
  const el = $<HTMLDivElement>("state");
  el.textContent = st ? `${st.ok ? "✓" : "✗"} ${st.day} • ${wib(st.at)} • ${st.msg}` : "Belum pernah mengirim.";
  el.className = st ? (st.ok ? "ok" : "bad") : "hint";
};

/** Isian sekarang; token/kata sandi kosong = pakai yang tersimpan. */
function current(): Partial<PublishCfg> {
  return {
    repo: repo.value.trim(),
    branch: branch.value.trim() || "main",
    token: token.value.trim() || saved.token,
    pass: pass.value || saved.pass,
  };
}

async function load() {
  const got = await chrome.storage.local.get([PUB_CFG_KEY, PUB_ON_KEY, PUB_STATE_KEY]);
  saved = (got[PUB_CFG_KEY] as Partial<PublishCfg>) ?? {};
  on.checked = !!got[PUB_ON_KEY];
  repo.value = saved.repo ?? "";
  branch.value = saved.branch ?? "main";
  token.placeholder = saved.token ? "•••• token tersimpan (kosongkan untuk tetap memakai)" : "github_pat_…";
  pass.placeholder = saved.pass ? "•••• tersimpan (kosongkan untuk tetap memakai)" : "";
  pass2.placeholder = pass.placeholder;
  showState(got[PUB_STATE_KEY] as PublishState | undefined);
}

$("save").addEventListener("click", async () => {
  if (pass.value !== pass2.value) return say("Kata sandi dan ulangannya berbeda.", false);
  const c = current();
  const errs = on.checked ? validatePublishCfg(c, MIN_PASS) : [];
  if (errs.length) return say(errs.join("\n"), false);
  if (saved.pass && pass.value && pass.value !== saved.pass && !confirm("Kata sandi data diganti. Data yang sudah terkirim tetap terkunci dengan kata sandi lama. Lanjut?")) return;
  await chrome.storage.local.set({ [PUB_CFG_KEY]: c, [PUB_ON_KEY]: on.checked });
  token.value = pass.value = pass2.value = "";
  await load();
  say(on.checked ? "Tersimpan. Publikasi online AKTIF." : "Tersimpan. Publikasi online NONAKTIF.", true);
});

$("test").addEventListener("click", async () => {
  const c = current();
  const errs = validatePublishCfg({ ...c, pass: "x".repeat(MIN_PASS) }, MIN_PASS);
  if (errs.length) return say(errs.join("\n"), false);
  say("Menguji…");
  try {
    say(await testConnection(c as PublishCfg), true);
  } catch (e) {
    say(e instanceof Error ? e.message : String(e), false);
  }
});

$("clear").addEventListener("click", async () => {
  if (!confirm("Hapus token & kata sandi dari ekstensi dan matikan publikasi?")) return;
  await chrome.storage.local.set({ [PUB_CFG_KEY]: { repo: repo.value.trim(), branch: branch.value.trim() || "main" }, [PUB_ON_KEY]: false });
  await load();
  say("Token & kata sandi dihapus; publikasi nonaktif.", true);
});

chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && ch[PUB_STATE_KEY]) showState(ch[PUB_STATE_KEY].newValue as PublishState);
});
void load();
