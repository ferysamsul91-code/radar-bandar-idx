// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import thresholds from "../../src/config/thresholds.json";
import type { ForeignSnap, InstSnap } from "../../src/core/rekap";
import { histKey, LIVE_PREFIX, putHistory, type RekapHistory } from "../../src/core/rekapRange";
import { buildPublishPayload, decidePublish, pubPath, PUB_KIND, validatePublishCfg, type PublishCfg, type PublishPayload } from "../../src/core/publish";
import { openSealed, seal, type SealedEnvelope } from "../../src/core/seal";
import { publishPayload, testConnection } from "../../src/core/githubPublish";
import { parseBrokerAnalysis, parseMoversForeign } from "../../src/content/parse-rekap";
import type { SessionCfg } from "../../src/core/session";

const S = thresholds.sessions as unknown as SessionCfg;
const wib = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h - 7, m); // 16 Nov 2026 = Senin
const fx = (f: string) => readFileSync(resolve(import.meta.dirname, "../../fixtures", f), "utf8");
const site = () => import(/* @vite-ignore */ resolve(import.meta.dirname, "../../site/rekap.js")) as Promise<{
  openSealed(env: SealedEnvelope, pass: string): Promise<PublishPayload>;
  renderPayload(p: PublishPayload, view?: string): string;
}>;

const PASS = "kata-sandi-uji-123";
const ITER = 1000; // cepat untuk tes (produksi 310.000)

describe("enkripsi data publikasi", () => {
  it("bolak-balik; kata sandi salah & metadata ditukar ditolak", async () => {
    const env = await seal({ a: 1, s: "ÄSII ✓" }, PASS, { kind: PUB_KIND, day: "2026-11-16", updatedAt: 5 }, ITER);
    expect(env).toMatchObject({ v: 1, kind: PUB_KIND, day: "2026-11-16", updatedAt: 5, alg: "AES-GCM", z: "gzip", iter: ITER });
    expect(JSON.stringify(env)).not.toContain("ASII");
    expect(await openSealed(env, PASS)).toEqual({ a: 1, s: "ÄSII ✓" });
    await expect(openSealed(env, "salah-salah-salah")).rejects.toThrow("kata sandi salah");
    await expect(openSealed({ ...env, day: "2026-11-17" }, PASS)).rejects.toThrow("kata sandi salah");
    await expect(seal({}, "pendek", { kind: PUB_KIND, day: "x", updatedAt: 0 })).rejects.toThrow("minimal 12");
  });
  it("landing page (site/rekap.js) membuka format yang sama", async () => {
    const env = await seal({ hello: "dunia" }, PASS, { kind: PUB_KIND, day: "2026-11-16", updatedAt: 1 }, ITER);
    const m = await site();
    expect(await m.openSealed(env, PASS)).toEqual({ hello: "dunia" });
    await expect(m.openSealed(env, "bukan-kata-sandinya")).rejects.toThrow("kata sandi salah");
  });
});

describe("isi publikasi & jadwal", () => {
  document.body.innerHTML = fx("movers-net-foreign-buy.html");
  const BUY = parseMoversForeign(document).rows;
  document.body.innerHTML = fx("movers-net-foreign-sell.html");
  const SELL = parseMoversForeign(document).rows;
  document.body.innerHTML = fx("broker-analysis.html");
  const BA = parseBrokerAnalysis(document);
  const D = "2026-11-16";
  const fb: ForeignSnap = { kind: "buy", day: D, capturedAt: wib(16, 16, 25), rows: BUY };
  const fs: ForeignSnap = { kind: "sell", day: D, capturedAt: wib(16, 16, 25), rows: SELL };
  const inst: InstSnap = { capturedAt: wib(16, 16, 25), day: D, ...BA, dateText: "16 Nov 26" };
  const h: RekapHistory = { fbuy: {}, fsell: {}, inst: {} };
  putHistory(h, histKey("fbuy", D), fb);
  putHistory(h, histKey("fsell", D), fs);
  putHistory(h, histKey("inst", D, D), inst);
  putHistory(h, LIVE_PREFIX + D, { day: D, savedAt: 0, rows: [{ code: "ASII", buy: 3e9, sell: 0, asingBuy: 0, asingSell: 0, instBuy: 3e9, instSell: 0, runs: 1, instRuns: 1 }] });
  const p = buildPublishPayload({ fb: null, fs: null, inst: null }, h, D, wib(16, 16, 30), "0.14.0");

  it("ringkasan hari ini + 5 hari: daftar institusi, asing, deteksi", () => {
    expect(p).toMatchObject({ v: 1, day: D, version: "0.14.0" });
    expect(p.brokers.length).toBeGreaterThan(0);
    expect(p.today.instBuy.length).toBeGreaterThan(5);
    expect(p.today.instBuy[0]!.rank).toBe(1);
    expect(p.today.foreignBuy.every((x) => x.foreign > 0)).toBe(true);
    expect(p.today.foreignSell.every((x) => x.foreign < 0)).toBe(true);
    expect(p.today.foreignBuy.length).toBeLessThanOrEqual(40);
    expect(p.today.liveInst[0]).toMatchObject({ code: "ASII", net: 3e9 });
    expect(p.d5.coverage).toHaveLength(6);
    expect(p.d5.coverage.at(-1)).toEqual({ day: D, foreign: true, inst: true });
  });
  it("tampil di landing page setelah dibuka", async () => {
    const m = await site();
    const html = m.renderPayload(p, "today");
    expect(html).toContain("DAFTAR TOTAL INSTITUSI NET BELI");
    expect(html).toContain("ASING NET JUAL");
    expect(html).toContain("DETEKSI INSTITUSI BELI");
    expect(html).toContain(p.today.instBuy[0]!.code);
    expect(m.renderPayload(p, "d5")).toContain("data asing 1/6 hari");
  });
  it("jadwal kirim otomatis", () => {
    const miss: string[] = [];
    expect(decidePublish(wib(16, 15, 0), S, "16:20", miss, true, null, 0)).toBeNull(); // sesi masih jalan
    expect(decidePublish(wib(16, 16, 25), S, "16:20", miss, true, null, 0)).toBe(D);
    expect(decidePublish(wib(16, 16, 25), S, "16:20", miss, true, { day: D, at: 0, ok: true, msg: "" }, 0)).toBeNull();
    expect(decidePublish(wib(16, 16, 25), S, "16:20", miss, true, { day: D, at: 0, ok: false, msg: "" }, wib(16, 16, 23))).toBeNull(); // jeda 5 mnt
    expect(decidePublish(wib(16, 16, 30), S, "16:20", ["institusi"], true, null, 0)).toBeNull(); // tunggu lengkap
    expect(decidePublish(wib(16, 18, 5), S, "16:20", ["institusi"], true, null, 0)).toBe(D); // setelah 18:00 kirim yang ada
    expect(decidePublish(wib(16, 18, 5), S, "16:20", ["asing beli", "asing jual", "institusi"], false, null, 0)).toBeNull();
    expect(decidePublish(wib(17, 8, 0), S, "16:20", miss, true, null, 0)).toBe(D); // pagi berikutnya: hari bursa kemarin
  });
  it("validasi pengaturan", () => {
    expect(validatePublishCfg({ repo: "a/b", branch: "main", token: "x".repeat(30), pass: "y".repeat(12) }, 12)).toEqual([]);
    expect(validatePublishCfg({ repo: "https://github.com/a/b", branch: "main", token: "", pass: "123" }, 12)).toHaveLength(3);
  });
});

describe("kirim ke GitHub (fetch tiruan)", () => {
  const cfg: PublishCfg = { repo: "pemilik/radar-bandar-idx", branch: "main", token: "github_pat_" + "x".repeat(30), pass: PASS };
  const payload = { v: 1, day: "2026-11-16" } as unknown as PublishPayload;
  type Call = { url: string; init?: RequestInit };
  const mock = (responses: Response[]) => {
    const calls: Call[] = [];
    const fn = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return responses.shift()!;
    };
    return { calls, fn };
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("file baru: PUT tanpa sha; isinya amplop terenkripsi yang bisa dibuka", async () => {
    const m = mock([json(404, { message: "Not Found" }), json(201, {})]);
    expect(await publishPayload(cfg, payload, 7, m.fn)).toBe(pubPath("2026-11-16"));
    expect(m.calls[0]!.url).toBe("https://api.github.com/repos/pemilik/radar-bandar-idx/contents/data/days/2026-11-16.enc.json?ref=main");
    expect((m.calls[0]!.init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${cfg.token}`);
    expect(m.calls[1]!.init!.method).toBe("PUT");
    const body = JSON.parse(String(m.calls[1]!.init!.body)) as { content: string; sha?: string; message: string; branch: string };
    expect(body).toMatchObject({ message: "data: rekap 2026-11-16", branch: "main" });
    expect(body.sha).toBeUndefined();
    const env = JSON.parse(atob(body.content)) as SealedEnvelope;
    expect(env).toMatchObject({ day: "2026-11-16", updatedAt: 7, kind: PUB_KIND });
    expect(await openSealed(env, PASS)).toEqual(payload);
  }, 20_000);
  it("file lama ditimpa dengan sha; galat izin diterjemahkan", async () => {
    const m = mock([json(200, { sha: "abc123" }), json(200, {})]);
    await publishPayload(cfg, payload, 7, m.fn);
    expect(JSON.parse(String(m.calls[1]!.init!.body)).sha).toBe("abc123");
    const e = mock([json(404, {}), json(403, { message: "Resource not accessible by personal access token" })]);
    await expect(publishPayload(cfg, payload, 7, e.fn)).rejects.toThrow(/HTTP 403 \(token tidak punya izin Contents/);
  }, 20_000);
  it("uji koneksi", async () => {
    const ok = mock([json(200, { full_name: "pemilik/radar-bandar-idx", private: false, permissions: { push: true } }), json(200, {})]);
    expect(await testConnection(cfg, ok.fn)).toBe("OK: pemilik/radar-bandar-idx (publik), branch main");
    const ro = mock([json(200, { permissions: { push: false } })]);
    await expect(testConnection(cfg, ro.fn)).rejects.toThrow("tidak bisa menulis");
    const bad = mock([json(401, { message: "Bad credentials" })]);
    await expect(testConnection(cfg, bad.fn)).rejects.toThrow("token tidak valid");
  });
});
