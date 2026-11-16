/**
 * Kirim satu file terenkripsi ke repo GitHub pengguna lewat REST API "contents" (1 commit per kiriman).
 * Dipanggil hanya dari service worker ekstensi (token tidak pernah ada di halaman Stockbit).
 */
import { PUB_KIND, pubPath, type PublishCfg, type PublishPayload } from "./publish";
import { seal } from "./seal";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const api = (cfg: PublishCfg, path: string) => `https://api.github.com/repos/${cfg.repo}${path}`;
const headers = (cfg: PublishCfg) => ({
  Authorization: `Bearer ${cfg.token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

async function ghError(r: Response, what: string): Promise<Error> {
  let detail = "";
  try {
    detail = ((await r.json()) as { message?: string }).message ?? "";
  } catch { /* tanpa isi */ }
  const hint =
    r.status === 401 ? "token tidak valid / kedaluwarsa"
      : r.status === 403 ? "token tidak punya izin Contents: Read and write untuk repo ini"
        : r.status === 404 ? "repo/branch tidak ditemukan atau token tidak punya akses ke repo ini"
          : r.status === 409 ? "bentrok dengan commit lain, coba lagi"
            : "";
  return new Error(`${what}: HTTP ${r.status}${hint ? ` (${hint})` : ""}${detail ? ` — ${detail}` : ""}`);
}

/** Uji token & repo: kembalikan pesan ringkas, lempar Error bila gagal. */
export async function testConnection(cfg: PublishCfg, fetchFn: FetchFn = fetch): Promise<string> {
  const r = await fetchFn(api(cfg, ""), { headers: headers(cfg) });
  if (!r.ok) throw await ghError(r, "cek repo");
  const j = (await r.json()) as { full_name?: string; private?: boolean; permissions?: { push?: boolean } };
  if (j.permissions && !j.permissions.push) throw new Error("token bisa membaca tetapi tidak bisa menulis ke repo ini");
  const b = await fetchFn(api(cfg, `/branches/${encodeURIComponent(cfg.branch)}`), { headers: headers(cfg) });
  if (!b.ok) throw await ghError(b, `cek branch ${cfg.branch}`);
  return `OK: ${j.full_name ?? cfg.repo} (${j.private ? "privat" : "publik"}), branch ${cfg.branch}`;
}

/** Enkripsi payload lalu tulis data/days/<hari>.enc.json (buat baru atau timpa). */
export async function publishPayload(cfg: PublishCfg, payload: PublishPayload, now: number, fetchFn: FetchFn = fetch): Promise<string> {
  const env = await seal(payload, cfg.pass, { kind: PUB_KIND, day: payload.day, updatedAt: now });
  const path = pubPath(payload.day);
  const url = api(cfg, `/contents/${path}`);
  let sha: string | undefined;
  const g = await fetchFn(`${url}?ref=${encodeURIComponent(cfg.branch)}`, { headers: headers(cfg) });
  if (g.ok) sha = ((await g.json()) as { sha?: string }).sha;
  else if (g.status !== 404) throw await ghError(g, "baca file lama");
  const body = { message: `data: rekap ${payload.day}`, content: btoa(JSON.stringify(env)), branch: cfg.branch, ...(sha ? { sha } : {}) };
  const p = await fetchFn(url, { method: "PUT", headers: { ...headers(cfg), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!p.ok) throw await ghError(p, "kirim file");
  return path;
}
