# Catatan perubahan

## 0.14.0 — 2026-11-16
- **Publikasi online (opsional, default nonaktif)**: ringkasan REKAP harian (daftar total institusi & asing beli/jual, deteksi institusi beli, hari ini dan 5 hari bursa) dikirim otomatis ke repo GitHub Anda setelah data penutupan lengkap, **terenkripsi** dengan kata sandi Anda (AES-GCM 256).
- Landing page: bagian **REKAP harian** yang membuka data dengan kata sandi data, langsung di browser.
- Halaman pengaturan ekstensi tersendiri untuk token GitHub dan kata sandi (tidak pernah diketik di halaman Stockbit). Tombol "Publikasikan sekarang" di tab REKAP.

## 0.13.0 — 2026-11-16
- REKAP: daftar khusus **DAFTAR TOTAL INSTITUSI NET BELI** dan **NET JUAL** (peringkat, porsi dari total, hari beli/jual, asing searah/lawan, baris TOTAL).
- Daftar total ikut di export PDF dan CSV.
- Panel: bagian lipat mengingat posisi buka/tutup saat panel diperbarui.

## 0.12.0 — 2026-11-16
- REKAP: **DETEKSI INSTITUSI BELI** dari pola lot besar live (rangkaian trade besar non-asing saat jam bursa), dengan pembanding Broker Analysis (searah/berlawanan).
- Pola live disimpan per hari bursa dan bisa diakumulasi untuk rentang tanggal; ikut cadangan JSON, PDF, dan CSV.
- Perbaikan: data jejak institusi tersimpan dengan tanggal hari yang benar saat pergantian hari.

## 0.11.0 — 2026-11-16
- **AUTO REKAP**: data asing (Movers) dan institusi (Broker Analysis) diambil otomatis setelah 16:20 WIB tiap hari bursa, plus data asing tiap 30 menit saat sesi. Tombol "Ambil rekap sekarang".
- Pola lot besar live dikelompokkan ASING atau INSTITUSI/LOKAL dari pergerakan F Buy/F Sell widget orderbook.

## 0.10 dan sebelumnya
- Panel radar: Scanner, skor flow, status bid/offer, pergantian sisi, toast, watchlist/blacklist, export CSV/JSONL.
- Broker Summary (asing/lokal/BUMN), Jejak Institusi (broker non-ritel, XL dan XC dikecualikan).
- REKAP penutupan: asing & institusi, rentang tanggal (hari ini, 5 hari, rentang bebas), export PDF/CSV, riwayat harian 365 hari dengan cadangan.
- DIVERGENCE: hidden bullish/bearish dan regular divergence dari RSI 14 di Chartbit.
- Parser running trade untuk format sesi live (broker disembunyikan BEI saat jam bursa).
