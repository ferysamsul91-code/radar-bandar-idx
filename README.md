# Radar Bandar IDX (v0.13.0, tahap 1–5 + Broker Summary + REKAP + Jejak Institusi)

Ekstensi Chrome (Manifest V3) yang **membaca** running trade dan orderbook di
`stockbit.com/orderbook` yang sudah Anda buka dan login sendiri, lalu menampilkan
arus beli/jual lot besar.

> **Bukan rekomendasi beli/jual.** Alat bantu baca arus order untuk pemakaian pribadi.
> Membaca DOM Stockbit tetap berada di area abu-abu Ketentuan Layanan Stockbit; risikonya Anda tanggung.

## Batasan
- Hanya membaca DOM yang tampil di layar. Tidak memanggil API internal Stockbit,
  tidak membaca/menyimpan cookie atau token Stockbit, tidak mengirim data ke luar, tidak ada order.
- **Satu pengecualian, atas permintaan pengguna:** *Publikasi online* (default NONAKTIF). Bila Anda aktifkan, ringkasan REKAP
  dikirim **terenkripsi** ke repo GitHub Anda sendiri (lihat "Publikasi REKAP online" di bawah). Untuk itu ekstensi punya
  service worker dan izin host `https://api.github.com/*`.
- Izin ekstensi: `storage` (posisi panel, settings, riwayat REKAP) dan `api.github.com` (hanya untuk publikasi). Aktif hanya di
  `https://stockbit.com/orderbook*` (panel radar), `https://stockbit.com/symbol/*` (hanya membaca widget Broker Summary
  & panel Movers, tanpa panel radar) dan `https://stockbit.com/broker-analysis/*` (hanya membaca Top Buy/Top Sell).

## Status
| Tahap | Isi | Status |
|---|---|---|
| 1 | Scaffold MV3 + panel kosong di Shadow DOM | selesai |
| 2a | Parser orderbook (widget stockbit.com/orderbook) + test fixture asli | selesai |
| 2b | Parser running trade (panel samping "Running Trade") + pelacak baris baru + test | selesai |
| 2c | Parser Broker Summary (widget di stockbit.com/symbol/KODE) + test fixture asli + tabel di tab ASING / LOKAL | selesai |
| 3 | Core: normalize, aggressor, bigLot/cluster, windows, dedup + unit test | selesai |
| 4 | Skor, status, pergantian sisi, lifecycle bid/offer, kualitas Q + 10 skenario test; tab SCANNER & filter status | selesai |
| 5 | Toast, Settings, klik kode, watchlist/blacklist, export CSV/JSONL, jam sesi, reset harian | selesai |
| 6–7 | Peta broker penuh (pakai kategori Stockbit ke running trade), replay JSONL, uji performa | belum |

### REKAP penutupan: cara pakai
1. Di `/orderbook` (atau halaman emiten), buka panel **Movers** (ikon api di rel kanan), klik tab **Net Foreign Buy**,
   lalu **Net Foreign Sell**. Masing-masing terbaca otomatis (top 50 emiten seluruh pasar, data investor asing Stockbit).
2. Buka **Broker Analysis** (`stockbit.com/broker-analysis/broker`), pilih broker institusi sendiri (mis. AK ZP BK KZ RX),
   pastikan sakelar **Net** aktif. Top Buy/Top Sell (net GABUNGAN broker terpilih) terbaca otomatis.
3. Panel radar → tab **REKAP**: asing & institusi sama-sama beli / sama-sama jual / berlawanan / hanya satu pihak,
   lengkap dengan avg harga institusi. Tombol **EXPORT REKAP CSV** / **EXPORT REKAP PDF** menyimpan file lokal
   (PDF A4 dibuat di browser tanpa library & tanpa jaringan: ringkasan, 7 tabel berwarna, catatan, nomor halaman).
- Radar tidak mengklik tab, tidak memilih broker, tidak mengubah filter: hanya membaca yang Anda buka.
- Hari bursa data asing = perkiraan (hari libur bursa tidak diketahui). Data yang diambil sebelum 16:15 WIB pada hari itu
  ditandai "sesi berjalan, belum final". Peringatan muncul bila tanggal sumber berbeda atau sakelar Net tampak mati.
- "Institusi" = broker pilihan Anda: ESTIMASI (broker juga melayani nasabah non-institusi).

### Catatan sesi live (dicek 2026-11-16)
- Panel **Running Trade** harus dibuka (ikon ke-3 di sisi kanan orderbook); tanpa itu status bar menulis "RT: buka panel Running Trade".
- Selama jam bursa BEI **tidak menampilkan kode broker & tipe investor [D]/[F]** di running trade (kolom Buyer/Seller tidak ada;
  status "BROKER TIDAK TAMPIL"). Akibatnya ASING/LOKAL dari running trade dan JEJAK INSTITUSI hanya terisi dari baris yang
  menampilkan broker (setelah bursa tutup). Data institusi utama tetap dari Broker Analysis / Broker Summary (akhir hari).
- Kunci trade memakai `data-row-key` (kode|nomor trade|epoch): tidak ada trade terhitung ganda, waktu tepat.

### POLA LOT BESAR LIVE (tanpa broker, jam bursa)
- Tab JEJAK INSTITUSI bagian atas. Rangkaian trade lot besar per emiten & sisi agresor (Buy/Sell): jeda <= 5 mnt, >= 3 trade >= Rp100 jt,
  total >= Rp1 M (ambang di Settings -> instTrace).
- Kategori dari **F Buy / F Sell widget orderbook** (akumulasi asing yang bergerak live): **ASING** bila naik >= 50% nilai rangkaian
  (foreignShareMin), **INSTITUSI/LOKAL** bila tidak, **?** bila emiten tidak punya widget orderbook terbuka. Toast muncul saat pola baru.
- ESTIMASI: F Buy/F Sell mencakup semua transaksi asing emiten itu; sisi = agresor (akumulasi pasif di bid tampil sebagai JUAL).
  Buka widget orderbook untuk emiten pantauan agar kategori asing terukur.

### DAFTAR TOTAL INSTITUSI di REKAP (v0.13.0)
- Tab REKAP -> **📋 DAFTAR TOTAL INSTITUSI NET BELI** dan **NET JUAL**: semua emiten dengan net institusi (Broker Analysis atau jejak
  running trade, sesuai sakelar sumber) dari semua kelompok (sama-sama beli, berlawanan, institusi saja) dalam satu daftar berperingkat.
- Kolom: #, KODE, INST NET (Σ untuk rentang), PORSI dari total, AVG INST, HARI BELI/JUAL (mis. 2/2 = net beli di 2 dari 2 hari data
  harian; tidak tampil bila rentang diambil langsung dari Broker Analysis), ASING NET (searah/lawan), HARGA, CHG. Baris TOTAL di bawah.
- Ikut di PDF (setelah ringkasan total) dan CSV (blok "DAFTAR TOTAL INSTITUSI"). ESTIMASI, bukan rekomendasi beli/jual.

### DETEKSI INSTITUSI BELI di REKAP (v0.12.0)
- Pola lot besar live disimpan per hari bursa di `rbLiveH:YYYY-MM-DD` tiap 30 detik (rekaman rangkaian digabung, jadi memuat ulang
  halaman atau membuka 2 tab tidak menghitung dua kali). Ikut di cadangan JSON dan kolom POLA LIVE di RIWAYAT TERSIMPAN.
- Tab REKAP -> bagian **🏦 DETEKSI INSTITUSI BELI**: emiten dengan net beli pola INSTITUSI/LOKAL (INST BELI − INST JUAL > 0), urut net
  terbesar, untuk pilihan TERBARU / HARI INI / 5 HARI / RENTANG (dijumlah per hari, kolom HARI). Kolom BROKER ANALYSIS: "✓ searah" bila
  broker pilihan Anda juga net beli emiten itu, "✗ berlawanan" bila net jual.
- Emiten tanpa widget orderbook (kategori ?) dipisah di daftar lipat "TANPA widget orderbook".
- Ikut di EXPORT REKAP PDF dan CSV (blok kedua di bawah CSV REKAP). ESTIMASI, bukan rekomendasi beli/jual.

### JEJAK INSTITUSI (running trade live)
- Tab **JEJAK INSTITUSI**: rangkaian transaksi besar dari **broker yang sama** dalam waktu berdekatan.
  Dilihat dari sisi broker (broker pembeli = BELI, broker penjual = JUAL), bukan sisi agresor.
- Aturan bawaan (ESTIMASI, ubah di Settings → `instTrace`): jeda antar-trade ≤ 5 menit, ≥ 3 trade bernilai ≥ Rp100 jt,
  total ≥ Rp1 M. **Broker ritel XL dan XC tidak dihitung sebagai institusi** (`excludeBrokers`); trade silang dilewati.
- Tampil: net per broker per emiten (beli/jual, lot, avg) dan daftar kejadian (jam, durasi, lot, nilai, avg, AKTIF/selesai,
  tanda F/D = tipe investor mayoritas dari [F]/[D]). Net harian disimpan lokal (`rbInstH:TANGGAL`).
- Butuh panel Running Trade terbuka di jam bursa dan kode broker tampil. Jejak = pola transaksi, bukan identitas pemilik dana.
- REKAP memberi peringatan bila XL/XC ikut terpilih sebagai broker institusi di Broker Analysis.

### DIVERGENCE (Chartbit)
- Buka `stockbit.com/symbol/KODE/chartbit` (mis. IHSG, MEDC), klik kanan grafik → **Table view**. Radar membaca tabel
  (tanggal, OHLC, kolom indikator) dari layar dan menyimpannya per emiten (`rbChart:KODE:TF`, maks 400 candle).
  Ganti simbol di Chartbit untuk menambah emiten; gulir tabel ke bawah untuk menambah candle lama.
- Osilator bawaan **RSI 14**: kolom RSI dari Table view (pasang indikator RSI 14 di Chartbit agar sama dengan grafik);
  bila tidak ada, RSI 14 dihitung radar dari close (kurang akurat dengan ±40 candle). Pilihan lain di Settings: auto, Stoch RSI, MACD.
- Deteksi gaya indikator "Divergences" TradingView: pivot osilator kiri 5 / kanan 5, jarak pivot 5–60 candle.
  **BULLISH** harga LL + osilator HL • **HIDDEN BULLISH** harga HL + osilator LL • **BEARISH** harga HH + osilator LH •
  **HIDDEN BEARISH** harga LH + osilator HH. Sinyal terkonfirmasi 5 candle setelah pivot. "Baru" = ≤ 15 candle lalu.
  Semua parameter di Settings → `divergence` (ESTIMASI).
- Tab **DIVERGENCE**: daftar emiten per jenis sinyal + tabel semua emiten tercatat (sinyal terakhir tiap jenis).
- **DAFTAR PINDAI** (semi-manual): isi daftar kode (atau PAKAI WATCHLIST), lalu di Chartbit buka Table view sekali dan ketik
  kode berikutnya di grafik + Enter. Panel menampilkan progres x/y untuk hari bursa terakhir, tautan emiten berikutnya, dan
  penanda di Chartbit menulis "daftar pindai x/y • berikutnya: KODE". Radar tidak berpindah emiten sendiri.
- Batasan: hanya emiten yang Anda buka di Chartbit (tidak memindai seluruh BEI); Table view hanya merender ±40 candle sekaligus.

### AUTO REKAP (tanpa perintah manual)
- Selama ada 1 tab stockbit.com/orderbook terbuka, ekstensi mengambil REKAP sendiri: **setiap hari bursa setelah 16:20 WIB**
  (asing Net Foreign Buy/Sell + institusi broker pilihan), maks 2 percobaan per hari bila belum lengkap; **saat sesi** Movers
  diperbarui tiap 30 menit (data asing sementara). Tombol **AMBIL REKAP SEKARANG** di tab REKAP untuk jalan kapan saja.
- Caranya: halaman Broker Analysis dimuat di **iframe tersembunyi** (origin sama), ekstensi mengklik chip "Recent Selected Broker"
  (harus sama dengan Settings → autoRekap.brokers, bawaan AK ZP BK KZ RX) dan tab Movers Net Foreign Buy/Sell, membaca tabelnya,
  menyimpan ke riwayat, mengembalikan Movers ke Top Gainer, lalu menutup iframe. Tanpa API, tanpa data keluar, tanpa order.
- Ini melampaui prinsip awal "hanya membaca": ekstensi mengklik tab/chip Stockbit sekali per jadwal. Matikan dengan
  Settings → autoRekap.enabled = false. Bila chip Recent Selected Broker berbeda, pilih broker itu sekali secara manual.
- Kunci antar-tab mencegah auto berjalan ganda bila beberapa tab Stockbit terbuka. Hasil terakhir tampil di tab REKAP.

### Riwayat harian & akumulasi
- Setiap data REKAP disimpan per hari bursa di chrome.storage.local (izin `unlimitedStorage`), **disimpan 365 hari**:
  asing beli/jual (Movers), institusi Broker Analysis (harian & rentang), dan jejak institusi running trade (`rbInstH:`).
- Tab REKAP → **RIWAYAT TERSIMPAN**: tabel per hari bursa (asing beli, asing jual, institusi BA, jejak RT, lengkap/kurang,
  asing final atau belum). Pilih rentang (S/D 5 HARI, RENTANG) untuk menjumlah beberapa hari.
- **Sumber institusi**: BROKER ANALYSIS (broker pilihan) atau JEJAK RUNNING TRADE (rangkaian besar broker non-ritel, terkumpul
  otomatis selama panel Running Trade terbuka di jam bursa).
- **Pengingat**: setelah 16:15 WIB (dan di luar jam bursa) status bar menulis "REKAP TANGGAL belum: …" sampai data hari bursa
  terakhir lengkap (asing beli, asing jual, institusi dari BA atau jejak RT).
- **EXPORT / IMPORT RIWAYAT (JSON)**: cadangan lokal (riwayat, jejak, Broker Summary, pengaturan). Simpan sebelum Remove
  ekstensi atau untuk pindah komputer; data lokal ikut terhapus saat ekstensi di-Remove. Pengaturan hasil impor aktif setelah refresh.
- Radar tetap tidak mengambil data di belakang layar: riwayat hanya bertambah dari halaman yang Anda buka.

### REKAP per rentang tanggal
- Tab REKAP: **TERBARU** (pengambilan terakhir), **HARI INI**, **S/D 5 HARI BURSA LALU** (hari bursa terakhir + 5 hari bursa
  sebelumnya), **RENTANG** (isi tanggal dari–sampai, TERAPKAN). Tampil: total asing net beli/jual dan institusi net beli/jual,
  tabel per emiten berisi jumlah net sepanjang rentang, harga akhir, perubahan harga sepanjang rentang, dan ketersediaan data per hari.
- Setiap pengambilan disimpan per hari bursa (`rbRekapH:*` di chrome.storage.local, dihapus setelah 180 hari).
- **Asing**: Movers hanya menampilkan hari berjalan, jadi riwayat asing terkumpul dari hari ke hari (buka Movers tiap hari bursa,
  sebaiknya setelah 16:15 WIB). Hari tanpa data dihitung 0 dan ditandai ESTIMASI.
- **Institusi**: pilih rentang di pemilih tanggal Broker Analysis (Last 7D, kalender) -> rentang itu tersimpan dan dipakai langsung
  bila tanggalnya sama persis dengan pilihan REKAP (tombol "Rentang institusi tersimpan"). Selain itu dijumlah dari data harian.
- Export CSV (dengan baris TOTAL) dan PDF mengikuti rentang yang dipilih: `radar-rekap_DARI_sd_SAMPAI.pdf`.
- Hari libur bursa tidak diketahui (Senin–Jumat dianggap hari bursa).

### Broker Summary: cara pakai
- Buka `stockbit.com/symbol/KODE` (mis. BBCA) di tab lain. Widget **Broker Summary** di kolom kanan dibaca otomatis;
  penanda kecil "Radar: Broker Summary KODE … terbaca" muncul di kiri bawah selama 5 detik.
- Ringkasannya muncul di panel orderbook, tab **ASING / LOKAL** bagian BROKER SUMMARY: net broker asing / lokal / BUMN,
  top 3 buyer & seller (warna = kategori Stockbit), label TOP 3, tanggal & filter yang sedang dipilih di Stockbit.
- Kategori broker diambil dari atribut `type="foreign|local|bumn"` milik Stockbit (terverifikasi 2026-11-14 pada BBCA & GOTO).
  Ini **kepemilikan broker**, bukan kebangsaan investor. Untuk investor asing saja, pilih filter "Foreign" di widget Stockbit.
- Label AKUMULASI/DISTRIBUSI = (top 3 beli − top 3 jual) / (top 3 beli + top 3 jual), ambang 0,3: **ESTIMASI** radar,
  bukan indikator "Broker Action" Stockbit. Ubah di Settings (`brokerSummary`).
- Ringkasan disimpan lokal; tampil maks 24 jam (`maxAgeHours`), dihapus setelah 7 hari. Belum masuk ke skor.
- Jika Anda pindah halaman tanpa reload (klik menu Stockbit), ekstensi mungkin tidak aktif: refresh tab `/symbol/KODE`.

### Tahap 5: cara pakai
- **Toast** muncul di bawah panel saat emiten masuk FLOW KUAT (hijau), PADA JUALAN (merah), atau naik ke A+ (oranye).
  Maks 3 sekaligus, cooldown 60 dtk per emiten, hilang setelah 10 dtk. Tidak muncul jika Q < 50. Klik toast = sama dengan klik kode.
- **Klik kode** (di tabel mana pun) mengisi kotak kode widget orderbook: widget yang terakhir Anda klik, lalu widget kosong,
  lalu widget pertama (kotak pencarian global Stockbit tidak pernah dipakai). Stockbit membuka dropdown emiten (dicek live
  2026-11-14); pilih sendiri emitennya. Radar tidak menekan Enter. Jika batal (Escape), isian widget kosong sampai
  Anda pilih ulang atau refresh; radar tetap memakai kode terakhir widget itu.
- **⚙ Settings**: watchlist (tanda W, di atas), blacklist (disembunyikan), bunyi on/off, toast hanya watchlist,
  tabel broker, dan semua ambang `thresholds.json` (termasuk jam sesi dan jam reset). Disimpan di `chrome.storage.local`.
  Saat disimpan, mesin dihitung ulang dari trade sesi ini. Tombol BAWAAN mengembalikan semua ke default.
- **Export CSV/JSONL**: trade sesi ini diunduh sebagai file lokal `radar-bandar_TANGGAL.csv/.jsonl`. Tidak ada yang dikirim ke luar.
- **Reset harian** otomatis saat jam `dailyResetWIB` (08:45 WIB) lewat. Fase sesi (PRA-BUKA, SESI 1, ISTIRAHAT, SESI 2, PRA-TUTUP, TUTUP)
  tampil di status bar. Hari libur bursa tidak dideteksi.
- **WebSocket tap** dikunci OFF: format pesan WebSocket Stockbit belum diketahui, jadi belum dibuat.
- Trade sesi hanya disimpan di memori tab (maks 300.000). Refresh tab = data sesi hilang; export dulu jika perlu.
- Panel "Cari Induk" (opsional di spesifikasi) belum dibuat.

Parameter tahap 4 yang masih **ESTIMASI** (belum dikalibrasi data live) ada di `src/config/thresholds.json`:
`lifecycle.*`, `status.rame`, `score.aggrFlowNormMinutes`, serta bobot penalti kualitas Q.

Panel saat ini menampilkan tabel per widget orderbook: LAST, BID, OFFER, AQI, DEPTH 5, F NET
(F Buy − F Sell dari widget Stockbit), plus status "PARSER xx" dan "OB n/m".
Fixture `fixtures/orderbook-widgets.html` diambil dari DOM asli 2026-11-13 (dirampingkan, tanpa data akun).
Parser tidak memakai class CSS Stockbit (hash yang berubah-ubah), tetapi atribut `type="label"/"value"`,
input kode emiten, dan teks judul `Freq | Lot | Bid | Offer | Lot | Freq`.
**Running trade**: buka panel samping "Running Trade" di `stockbit.com/orderbook` (ikon ke-3 di sisi kanan).
Tanpa panel itu terbuka, status panel radar menampilkan "RT: buka panel Running Trade".
Kolom dibaca lewat judul (`Time, Code, Price, Action, Lot, Buyer, Seller, Val, Market`), jadi urutan kolom boleh berubah.
Sisi trade diambil dari kolom **Action** (Buy/Sell) Stockbit. Kode broker dan [D]/[F] dibaca jika tampil (status "BROKER TAMPIL").
Baris identik berulang (mis. GOTO 33.690 lot pada detik yang sama) dihitung sebagai trade berbeda; re-render tabel tidak dihitung ulang.
Jangan mengurutkan kolom Time naik atau memfilter per emiten di panel Stockbit selama radar berjalan.

Baris khusus di atas grid (6 sel, mis. `- | 26,477 | 5,475 | 5,500 | 13,640 | -`) belum diketahui artinya, jadi tidak dipakai.
`src/config/brokers.json` **belum diverifikasi** ke daftar anggota bursa terbaru.

## Build & test
Di PowerShell pakai `npm.cmd` (Execution Policy memblokir `npm.ps1`):

```
npm.cmd install
npm.cmd test
npm.cmd run build
```

Hasil build ada di folder `dist/` (`manifest.json`, `content.js`, `background.js`, `options.html`, `options.js`, `config/`).

## Landing page (GitHub Pages)
- Sumber: `site/index.html` (+ `site/assets/rekap.png`, data rekaan dengan kode fiktif) dan `CHANGELOG.md`.
- `npm.cmd run build` lalu `npm.cmd run site` -> `_site/` berisi halaman + ZIP ekstensi siap "Load unpacked".
- `.github/workflows/pages.yml` membangun ulang dan menerbitkan halaman saat push ke `main`, setiap hari 06:00 WIB, dan manual.
  Workflow hanya memakai kode di repo: tidak membuka Stockbit, tidak memakai login/cookie/token. Fixture HTML Stockbit
  tidak ikut repo (`.gitignore`), jadi tes penuh dijalankan lokal sebelum rilis.
- Setelah repo dibuat: Settings -> Pages -> Source: **GitHub Actions**.
- Rilis versi baru: naikkan versi (`package.json`, `src/manifest.json`, `VERSION` di `src/ui/Panel.ts`), tambah entri di
  `CHANGELOG.md`, commit dan push ke `main`. Ekstensi juga menulis commit data ke `main`, jadi `git pull --rebase` dulu
  sebelum push dari komputer.

## Publikasi REKAP online (v0.14.0, opsional)
- Alur: AUTO REKAP 16:20 WIB -> data penutupan lengkap (atau setelah 18:00, apa yang ada) -> content script menyusun
  ringkasan (`core/publish.ts`: hari ini + 5 hari bursa, top 40 per daftar) -> service worker (`src/background`)
  mengenkripsi (`core/seal.ts`: gzip, AES-GCM 256, PBKDF2-SHA256 310.000 iterasi, metadata `kind|day` sebagai AAD)
  -> `PUT data/days/TANGGAL.enc.json` lewat GitHub API (1 commit) -> workflow Pages membangun ulang halaman.
- Landing page (`site/rekap.js`) memuat `data/index.json` (daftar hari, dibuat `scripts/build-site.mjs`) lalu membuka
  file hari terpilih dengan kata sandi di browser. Tanpa kata sandi hanya tanggal yang terbaca.
- Pengaturan: chrome://extensions -> Radar Bandar IDX -> Details -> **Extension options** (atau tombol ⚙ di tab REKAP).
  Isi repo `pemilik/nama-repo`, branch, token GitHub *fine-grained* (hanya repo itu, **Contents: Read and write**), dan
  kata sandi data (min. 12 karakter). Token & kata sandi hanya dipakai di halaman pengaturan dan service worker,
  tidak pernah di halaman Stockbit, dan tidak ikut file cadangan.
- Kirim manual: tab REKAP -> **⇪ PUBLIKASIKAN SEKARANG** (menimpa file hari itu).
- Kata sandi yang diganti tidak mengubah file lama: file lama tetap terbuka dengan kata sandi lamanya.

## Memuat ke Chrome
1. Buka `chrome://extensions`.
2. Aktifkan **Developer mode** (kanan atas).
3. Klik **Load unpacked**, pilih folder `D:\konten\radar-bandar-idx\dist`.
4. Buka `https://stockbit.com/orderbook` (sudah login). Panel "Radar Bandar IDX" muncul di kanan atas.
5. Setelah `npm.cmd run build` ulang, klik ikon ↻ (reload) pada kartu ekstensi lalu refresh tab Stockbit.

## Fixture untuk tahap 2
Simpan halaman `stockbit.com/orderbook` saat running trade dan orderbook sedang tampil
(Ctrl+S → "Webpage, Complete") ke folder `fixtures/`, mis. `fixtures/orderbook.html`.
Fixture ini hanya untuk test lokal; jangan dibagikan.

## Struktur
```
src/manifest.json         manifest MV3
src/content/index.ts      content script (pasang panel)
src/ui/Panel.ts           panel Shadow DOM (drag, JEDA, COMPACT, minimize, tab)
src/core/                 normalize, ticks, aggressor, bigLot, windows, dedup, types
src/config/               thresholds.json, brokers.json, selectors.json
tests/unit/               Vitest
```
