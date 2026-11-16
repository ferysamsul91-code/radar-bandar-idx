/**
 * Service worker ekstensi: satu-satunya tempat token GitHub & kata sandi data dipakai.
 * Pesan dari content script:
 *   { type: "rb-publish", payload, force } -> enkripsi + kirim ke repo, simpan status di rbPublishState
 *   { type: "rb-open-options" }            -> buka halaman pengaturan publikasi
 */
import { publishPayload } from "../core/githubPublish";
import { PUB_CFG_KEY, PUB_ON_KEY, PUB_STATE_KEY, validatePublishCfg, type PublishCfg, type PublishPayload, type PublishState } from "../core/publish";
import { MIN_PASS } from "../core/seal";

let inflight: Promise<PublishState> | null = null;

async function handlePublish(payload: PublishPayload, force: boolean): Promise<PublishState> {
  const got = await chrome.storage.local.get([PUB_CFG_KEY, PUB_ON_KEY, PUB_STATE_KEY]);
  const prev = got[PUB_STATE_KEY] as PublishState | undefined;
  const now = Date.now();
  if (!got[PUB_ON_KEY]) return { day: payload.day, at: now, ok: false, msg: "publikasi online nonaktif" };
  if (!force && prev?.day === payload.day && prev.ok) return prev;
  const cfg = got[PUB_CFG_KEY] as PublishCfg | undefined;
  const errs = validatePublishCfg(cfg ?? {}, MIN_PASS);
  let st: PublishState;
  if (!cfg || errs.length) st = { day: payload.day, at: now, ok: false, msg: `pengaturan belum lengkap: ${errs.join("; ")}` };
  else {
    try {
      const path = await publishPayload(cfg, payload, now);
      st = { day: payload.day, at: now, ok: true, msg: `terkirim ${path}` };
    } catch (e) {
      st = { day: payload.day, at: now, ok: false, msg: e instanceof Error ? e.message : String(e) };
    }
  }
  await chrome.storage.local.set({ [PUB_STATE_KEY]: st });
  return st;
}

chrome.runtime.onMessage.addListener((msg: { type?: string; payload?: PublishPayload; force?: boolean }, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (msg?.type === "rb-publish" && msg.payload) {
    inflight ??= handlePublish(msg.payload, !!msg.force).finally(() => (inflight = null));
    void inflight.then(sendResponse);
    return true;
  }
  if (msg?.type === "rb-open-options") {
    void chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
  }
  return false;
});
