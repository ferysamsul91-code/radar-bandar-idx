/** Aksi kecil di halaman yang bisa dites tanpa menjalankan content script. */
import type { EmitenView } from "../core/engine";
import { findWidgetRoot, type OrderbookSelectors } from "./parse-orderbook";

/** Watchlist di atas (urutan skor dipertahankan), blacklist dibuang. */
export function arrangeViews(views: EmitenView[], watch: ReadonlySet<string>, black: ReadonlySet<string>): EmitenView[] {
  const v = views.filter((x) => !black.has(x.code));
  return [...v.filter((x) => watch.has(x.code)), ...v.filter((x) => !watch.has(x.code))];
}

/**
 * Isi kotak kode di widget orderbook (input yang sudah ada di layar).
 * Target: widget yang terakhir diklik pengguna -> widget kosong -> widget pertama.
 * Hanya input yang benar-benar bagian widget orderbook (bukan pencarian global Stockbit).
 * Tidak menekan Enter dan tidak memanggil API; Stockbit membuka dropdown, pengguna memilih sendiri.
 * Terverifikasi live 2026-11-14: event "input" membuka dropdown pilihan emiten Stockbit.
 * Jika pengguna batal (Escape), isian widget kosong sampai dipilih ulang / halaman di-refresh.
 */
export function fillCodeSearch(doc: Document, sel: OrderbookSelectors, code: string, preferred: HTMLInputElement | null): boolean {
  let inputs: HTMLInputElement[];
  try {
    inputs = [...doc.querySelectorAll<HTMLInputElement>(sel.codeInput)].filter((i) => findWidgetRoot(i, sel) !== null);
  } catch {
    return false;
  }
  const target = (preferred && inputs.includes(preferred) ? preferred : null) ?? inputs.find((i) => !i.value.trim()) ?? inputs[0];
  if (!target) return false;
  target.focus();
  // Setter prototipe: perubahan terdeteksi React walau dijalankan di dunia halaman (sama dengan dunia terisolasi).
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(target, code);
  else target.value = code;
  target.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}
