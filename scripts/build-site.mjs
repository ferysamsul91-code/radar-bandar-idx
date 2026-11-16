/**
 * Bangun landing page statis ke _site/ untuk GitHub Pages.
 *  - salin site/ -> _site/
 *  - bungkus dist/ (hasil `npm run build`) jadi ZIP siap "Load unpacked"
 *  - isi placeholder {{...}} di index.html: versi, tanggal, status tes, commit, catatan perubahan
 * Tanpa dependensi tambahan (ZIP ditulis manual dengan zlib bawaan Node).
 * Opsional: TEST_JSON=<file hasil `vitest run --reporter=json --outputFile=...`>.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { execSync } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const out = join(root, "_site");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;

if (!existsSync(join(dist, "manifest.json"))) throw new Error("dist/ belum ada: jalankan `npm run build` dulu");
const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
if (manifest.version !== version) throw new Error(`versi manifest ${manifest.version} != package.json ${version}`);

// ---------- ZIP ----------
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function zip(entries, when) {
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const comp = deflateRawSync(e.data, { level: 9 });
    const crc = crc32(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

// ---------- data halaman ----------
const now = new Date();
const wib = new Date(now.getTime() + 7 * 3600e3);
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const updated = `${wib.getUTCDate()} ${BULAN[wib.getUTCMonth()]} ${wib.getUTCFullYear()}, ${String(wib.getUTCHours()).padStart(2, "0")}:${String(wib.getUTCMinutes()).padStart(2, "0")} WIB`;
let commit = (process.env.GITHUB_SHA ?? "").slice(0, 7);
if (!commit) {
  try {
    commit = execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    commit = "lokal";
  }
}
let tests = "dijalankan lokal sebelum rilis";
let testsOk = null;
if (process.env.TEST_JSON && existsSync(process.env.TEST_JSON)) {
  const t = JSON.parse(readFileSync(process.env.TEST_JSON, "utf8"));
  testsOk = t.numFailedTests === 0 && t.success !== false;
  tests = `${t.numPassedTests}/${t.numTotalTests} tes lulus`;
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
function changelogHtml(md) {
  const blocks = [];
  let cur = null;
  for (const line of md.split(/\r?\n/)) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h) {
      cur = { title: h[1], items: [] };
      blocks.push(cur);
      continue;
    }
    const li = /^-\s+(.+)$/.exec(line);
    if (li && cur) cur.items.push(li[1]);
  }
  return blocks
    .map((b, i) => `<details class="rel"${i === 0 ? " open" : ""}><summary>${inline(b.title)}</summary><ul>${b.items.map((x) => `<li>${inline(x)}</li>`).join("")}</ul></details>`)
    .join("\n");
}

// ---------- tulis _site ----------
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "site"), out, { recursive: true });

const folder = "radar-bandar-idx";
const howto = Buffer.from(
  [
    `Radar Bandar IDX v${version}`,
    "",
    "Cara pasang:",
    "1. Ekstrak ZIP ini (hasilnya folder radar-bandar-idx).",
    "2. Buka chrome://extensions, nyalakan Developer mode.",
    "3. Klik Load unpacked, pilih folder radar-bandar-idx.",
    "4. Login Stockbit sendiri, buka https://stockbit.com/orderbook.",
    "",
    "Update: ganti isi folder dengan versi baru, lalu klik tombol reload (panah melingkar) di kartu ekstensi.",
    "",
    "Bukan rekomendasi beli/jual. Tidak berafiliasi dengan Stockbit atau Bursa Efek Indonesia.",
    "",
  ].join("\r\n"),
  "utf8",
);
const entries = [
  ...walk(dist).map((p) => ({ name: `${folder}/${relative(dist, p).split(sep).join("/")}`, data: readFileSync(p) })),
  { name: `${folder}/CARA-PASANG.txt`, data: howto },
];
const zipBuf = zip(entries, wib);
const zipName = `radar-bandar-idx-v${version}.zip`;
writeFileSync(join(out, zipName), zipBuf);
writeFileSync(join(out, "radar-bandar-idx-latest.zip"), zipBuf);

const kb = (n) => `${Math.round(n / 1024)} KB`;
const vars = {
  VERSION: version,
  ZIP: zipName,
  ZIP_SIZE: kb(zipBuf.length),
  UPDATED: updated,
  COMMIT: commit,
  TESTS: tests,
  TESTS_CLASS: testsOk === null ? "muted" : testsOk ? "ok" : "bad",
  CHANGELOG: changelogHtml(readFileSync(join(root, "CHANGELOG.md"), "utf8")),
};
for (const f of readdirSync(out).filter((x) => x.endsWith(".html"))) {
  const page = readFileSync(join(out, f), "utf8").replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
  const left = page.match(/\{\{\w+\}\}/g);
  if (left) throw new Error(`${f}: placeholder belum terisi: ${left.join(", ")}`);
  writeFileSync(join(out, f), page);
}
writeFileSync(join(out, "version.json"), JSON.stringify({ version, updated: now.toISOString(), commit, tests, zip: zipName }, null, 2));
writeFileSync(join(out, ".nojekyll"), "");

// REKAP harian terenkripsi (dikirim ekstensi ke data/days/*.enc.json): salin apa adanya + daftar hari yang tersedia.
// Hanya metadata terbuka (day, updatedAt) yang dibaca di sini; isinya tetap terenkripsi.
const dataDir = join(root, "data", "days");
const days = [];
mkdirSync(join(out, "data", "days"), { recursive: true });
if (existsSync(dataDir)) {
  for (const f of readdirSync(dataDir)) {
    if (!/^\d{4}-\d{2}-\d{2}\.enc\.json$/.test(f)) continue;
    const raw = readFileSync(join(dataDir, f), "utf8");
    let env;
    try {
      env = JSON.parse(raw);
    } catch {
      console.warn(`lewati ${f}: bukan JSON`);
      continue;
    }
    if (env?.v !== 1 || env.alg !== "AES-GCM" || `${env.day}.enc.json` !== f) {
      console.warn(`lewati ${f}: bukan amplop terenkripsi yang dikenal`);
      continue;
    }
    writeFileSync(join(out, "data", "days", f), raw);
    days.push({ day: env.day, updatedAt: env.updatedAt });
  }
}
days.sort((a, b) => b.day.localeCompare(a.day));
writeFileSync(join(out, "data", "index.json"), JSON.stringify({ updatedAt: now.toISOString(), days }, null, 2));
console.log(`REKAP harian: ${days.length} hari${days[0] ? ` (terbaru ${days[0].day})` : ""}`);
console.log(`_site siap: v${version}, ${zipName} (${kb(zipBuf.length)}, ${entries.length} file), ${tests}, ${updated}`);
