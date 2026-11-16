/**
 * Skor 0–100:
 *   30*norm(buyPct_mid) + 20*norm(aggrFlow_mid relatif) + 20*norm(bigNet_mid)
 * + 10*norm(instNet)    + 10*lifecycleScore             + 10*(Q/100)
 * - penalti (BID DITARIK, REFILL offer, dekat ARA, VWAP TERLALU JAUH).
 * Normalisasi (ESTIMASI, belum dikalibrasi):
 *   buyPct           : apa adanya (0..1); null -> 0
 *   aggrFlow relatif : aggrFlow / (median value per menit x N menit), dipotong ke [-1,1] lalu (x+1)/2
 *   bigNet           : bigNet / total value window, (x+1)/2
 *   instNet          : (asing + lokal inst net) / total value window, (x+1)/2; tanpa data broker -> 0.5
 */
export interface ScoreConfig {
  weights: { buyPct3m: number; aggrFlow: number; bigNet: number; instNet: number; lifecycle: number; quality: number };
  penalties: { bidDitarik: number; refillOffer: number; nearAra: number; vwapTooFar: number };
  grades: Record<string, number>;
}

export interface ScoreInput {
  buyPct: number | null;
  aggrFlow: number;
  /** median value per menit x N menit; null -> pakai totalValue */
  aggrFlowScale: number | null;
  bigNet: number;
  totalValue: number;
  instNet: number | null;
  lifecycle: number; // 0..1
  q: number; // 0..100
  bidDitarik: boolean;
  refillOffer: boolean;
  nearAra: boolean;
  vwapTooFar: boolean;
}

export interface ScoreResult {
  score: number;
  grade: "A+" | "A" | "B" | "";
  parts: Record<string, number>;
}

const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
const signed01 = (x: number) => (clamp(x) + 1) / 2;

export function computeScore(i: ScoreInput, c: ScoreConfig): ScoreResult {
  const w = c.weights;
  const tot = i.totalValue > 0 ? i.totalValue : 0;
  const scale = i.aggrFlowScale && i.aggrFlowScale > 0 ? i.aggrFlowScale : tot;
  const parts = {
    buyPct: w.buyPct3m * (i.buyPct ?? 0),
    aggrFlow: w.aggrFlow * (scale > 0 ? signed01(i.aggrFlow / scale) : 0.5),
    bigNet: w.bigNet * (tot > 0 ? signed01(i.bigNet / tot) : 0.5),
    instNet: w.instNet * (i.instNet !== null && tot > 0 ? signed01(i.instNet / tot) : 0.5),
    lifecycle: w.lifecycle * clamp(i.lifecycle, 0, 1),
    quality: w.quality * clamp(i.q / 100, 0, 1),
    penalty: -(
      (i.bidDitarik ? c.penalties.bidDitarik : 0) +
      (i.refillOffer ? c.penalties.refillOffer : 0) +
      (i.nearAra ? c.penalties.nearAra : 0) +
      (i.vwapTooFar ? c.penalties.vwapTooFar : 0)
    ),
  };
  const raw = Object.values(parts).reduce((a, b) => a + b, 0);
  const score = Math.round(clamp(raw, 0, 100));
  return { score, grade: gradeOf(score, c.grades), parts };
}

export function gradeOf(score: number, g: Record<string, number>): ScoreResult["grade"] {
  if (score >= (g["A+"] ?? 90)) return "A+";
  if (score >= (g["A"] ?? 80)) return "A";
  if (score >= (g["B"] ?? 65)) return "B";
  return "";
}
