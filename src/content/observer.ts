/**
 * Amati perubahan DOM (MutationObserver) dan panggil `onTick` paling cepat tiap `throttleMs`.
 * Hanya membaca DOM; tidak ada request jaringan. Mengembalikan fungsi untuk berhenti.
 */
export function startDomObserver(doc: Document, onTick: () => void, throttleMs = 500, ignore?: Node): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    try {
      onTick();
    } catch (e) {
      console.warn("[Radar Bandar IDX] parse gagal", e);
    }
  };
  const obs = new MutationObserver((muts) => {
    if (ignore && muts.every((m) => ignore.contains(m.target))) return; // perubahan panel kita sendiri
    if (!timer) timer = setTimeout(run, throttleMs);
  });
  obs.observe(doc.body, { subtree: true, childList: true, characterData: true });
  run();
  return () => {
    obs.disconnect();
    if (timer) clearTimeout(timer);
  };
}
