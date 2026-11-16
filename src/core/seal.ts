/**
 * Enkripsi data publikasi (REKAP online). Dipakai ekstensi untuk mengunci data sebelum dikirim ke repo GitHub pengguna;
 * landing page (site/rekap.js) memakai format yang sama untuk membukanya di browser dengan kata sandi pengguna.
 *  - JSON -> gzip (CompressionStream) -> AES-GCM 256
 *  - kunci = PBKDF2-SHA256(kata sandi, salt acak 16 byte, iter)
 *  - additionalData = "kind|day" (metadata terbuka tidak bisa ditukar tanpa ketahuan)
 * Hanya `kind`, `day`, `updatedAt` yang terbaca tanpa kata sandi.
 */
export interface SealedEnvelope {
  v: 1;
  kind: string;
  day: string;
  updatedAt: number;
  alg: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iter: number;
  z: "gzip" | "none";
  salt: string;
  iv: string;
  ct: string;
}
export const SEAL_ITER = 310_000;
export const MIN_PASS = 12;

export function b64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function through(data: Uint8Array<ArrayBuffer>, t: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const res = new Response(new Blob([data]).stream().pipeThrough(t));
  return new Uint8Array(await res.arrayBuffer());
}

async function deriveKey(pass: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

const aad = (kind: string, day: string) => new TextEncoder().encode(`${kind}|${day}`);

export async function seal(obj: unknown, pass: string, meta: { kind: string; day: string; updatedAt: number }, iter = SEAL_ITER): Promise<SealedEnvelope> {
  if (pass.length < MIN_PASS) throw new Error(`kata sandi minimal ${MIN_PASS} karakter`);
  const plain = new TextEncoder().encode(JSON.stringify(obj));
  const gz = typeof CompressionStream !== "undefined";
  const body = gz ? await through(plain, new CompressionStream("gzip")) : plain;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt, iter);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(meta.kind, meta.day) }, key, body));
  return { v: 1, kind: meta.kind, day: meta.day, updatedAt: meta.updatedAt, alg: "AES-GCM", kdf: "PBKDF2-SHA256", iter, z: gz ? "gzip" : "none", salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

/** Buka amplop; lempar Error "kata sandi salah" bila kunci tidak cocok atau data diubah. */
export async function openSealed<T = unknown>(env: SealedEnvelope, pass: string): Promise<T> {
  if (env?.v !== 1 || env.alg !== "AES-GCM" || env.kdf !== "PBKDF2-SHA256") throw new Error("format data tidak dikenal");
  const key = await deriveKey(pass, unb64(env.salt), env.iter);
  let body: Uint8Array<ArrayBuffer>;
  try {
    body = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(env.iv), additionalData: aad(env.kind, env.day) }, key, unb64(env.ct)));
  } catch {
    throw new Error("kata sandi salah atau data rusak");
  }
  const plain = env.z === "gzip" ? await through(body, new DecompressionStream("gzip")) : body;
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
