/**
 * Toast: dipicu saat emiten BERUBAH ke FLOW KUAT (hijau), PADA JUALAN (merah),
 * atau naik ke grade A+ (oranye). Antrean maks N, cooldown per emiten.
 */
import type { EmitenView } from "./engine";
import { formatCompact } from "./normalize";

export type ToastKind = "green" | "red" | "orange";
export interface Toast {
  id: number;
  code: string;
  kind: ToastKind;
  text: string;
  ts: number;
}
export interface ToastCfg {
  maxQueue: number;
  cooldownSec: number;
  ttlSec?: number;
}

export class AlertManager {
  private prev = new Map<string, { status: string; grade: string | null }>();
  private lastAt = new Map<string, number>();
  private seq = 0;
  queue: Toast[] = [];

  constructor(private cfg: ToastCfg, private minQ = 50) {}

  /** Kembalikan toast baru dari evaluasi ini; `allow` menyaring emiten (blacklist/watchlist). */
  evaluate(views: EmitenView[], now: number, allow: (code: string) => boolean = () => true): Toast[] {
    const ttl = (this.cfg.ttlSec ?? 10) * 1000;
    this.queue = this.queue.filter((t) => now - t.ts < ttl);
    const fresh: Toast[] = [];
    for (const v of views) {
      const before = this.prev.get(v.code) ?? { status: "NETRAL", grade: null };
      this.prev.set(v.code, { status: v.status, grade: v.score.grade });
      if (!allow(v.code) || v.q < this.minQ) continue;
      const flow = `AGGR FLOW ${formatCompact(v.m.mid.aggrFlow, true)}`;
      let t: Omit<Toast, "id" | "ts"> | null = null;
      if (v.status === "FLOW KUAT" && before.status !== "FLOW KUAT") t = { code: v.code, kind: "green", text: `${v.code}: FLOW KUAT • ${flow}` };
      else if (v.status === "PADA JUALAN" && before.status !== "PADA JUALAN") t = { code: v.code, kind: "red", text: `${v.code}: PADA JUALAN • ${flow}` };
      else if (v.score.grade === "A+" && before.grade !== "A+") t = { code: v.code, kind: "orange", text: `${v.code}: A+ KONFLUENSI • PRIORITAS PANTAU` };
      if (!t) continue;
      const last = this.lastAt.get(v.code);
      if (last !== undefined && now - last < this.cfg.cooldownSec * 1000) continue;
      this.lastAt.set(v.code, now);
      const toast = { ...t, id: ++this.seq, ts: now };
      fresh.push(toast);
      this.queue.push(toast);
    }
    while (this.queue.length > this.cfg.maxQueue) this.queue.shift();
    return fresh;
  }

  /** Toast di luar perubahan status (mis. pola lot besar live). Cooldown per kunci. */
  notify(key: string, code: string, kind: ToastKind, text: string, now: number): Toast | null {
    const last = this.lastAt.get(key);
    if (last !== undefined && now - last < this.cfg.cooldownSec * 1000) return null;
    this.lastAt.set(key, now);
    const toast = { id: ++this.seq, code, kind, text, ts: now };
    this.queue.push(toast);
    while (this.queue.length > this.cfg.maxQueue) this.queue.shift();
    return toast;
  }

  reset(): void {
    this.prev.clear();
    this.lastAt.clear();
    this.queue = [];
  }
}
