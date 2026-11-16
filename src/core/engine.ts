/**
 * Mesin per emiten: menerima Trade & BookSnapshot, menghasilkan metrik window, lot besar,
 * lifecycle, status, pergantian sisi, kualitas data, dan skor.
 * Trade NG/TN diabaikan untuk sinyal (hanya RG).
 */
import { BigLotThreshold, Clusterer, isSuperBig, type BigLotConfig } from "./bigLot";
import { depthRatio } from "./book";
import { BrokerMap, type PartyClass } from "./brokerMap";
import { LifecycleTracker, type LcEvent, type LifecycleConfig } from "./lifecycle";
import { computeScore, type ScoreConfig, type ScoreResult } from "./scoring";
import { SideChangeTracker, type FlowSide, type SideChange } from "./sideChange";
import { computeStatus, quality, rameLabel, vwapLabel, type QualityConfig, type RoleMetrics, type Status, type StatusConfig } from "./status";
import { tickSize } from "./ticks";
import type { BookSnapshot, Side, Trade } from "./types";
import { RollingWindow, WindowSet, labelFor, type WindowMetrics } from "./windows";

export type ModeKey = "scalping" | "intraday";

export interface Thresholds {
  modes: Record<ModeKey, { windowsSec: number[]; minBigValue: number; flowKuatAggrFlow: number }>;
  bigLot: BigLotConfig;
  status: StatusConfig & { sideChange: { confirmSec: number; minBigTrades: number }; volatilityWarn: number };
  score: ScoreConfig & { aggrFlowNormMinutes: number };
  quality: QualityConfig;
  vwap: { dekat: number; wajar: number };
  lifecycle: LifecycleConfig;
}

export interface BigEvent {
  ts: number;
  code: string;
  price: number;
  lot: number;
  /** Nilai yang ditambahkan ke window oleh trade ini (inkremental). */
  value: number;
  /** Total nilai cluster (untuk tampilan). */
  clusterValue: number;
  clusterId: number | null;
  side: Side;
  superBig: boolean;
  trades: number;
  buyer?: string;
  seller?: string;
  buyerType?: "D" | "F";
  sellerType?: "D" | "F";
}

export interface EmitenView {
  code: string;
  price: number | null;
  chgPct: number | null;
  roles: [string, string, string];
  m: RoleMetrics;
  status: Status;
  rame: ReturnType<typeof rameLabel>;
  q: number;
  qLabel: string | null;
  score: ScoreResult;
  stars: number;
  warn: boolean;
  vwap: number | null;
  vwapDist: number | null;
  vwapLabel: ReturnType<typeof vwapLabel>;
  bigLot: number | null;
  sideChange: SideChange | null;
  sidePending: { to: FlowSide; since: number; big: number } | null;
  lifecycle: LcEvent[];
  flags: ReturnType<LifecycleTracker["flags"]>;
  depth: number | null;
  /** Net per pihak (Rupiah) di window tengah & sesi. null jika tidak ada data broker/D-F. */
  party: { foreign: number; localInst: number; retail: number; sessForeign: number; sessLocalInst: number; sessRetail: number } | null;
  sessionTrades: number;
  lastTradeTs: number | null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export class EmitenEngine {
  readonly windows: WindowSet;
  readonly roles: [string, string, string];
  private big: BigLotThreshold;
  readonly lc: LifecycleTracker;
  readonly sc: SideChangeTracker;
  private party: Record<Exclude<PartyClass, "UNKNOWN">, RollingWindow>;
  private sessParty: Record<Exclude<PartyClass, "UNKNOWN">, RollingWindow>;
  private brokerSeen = false;
  private vwapNum = 0;
  private vwapDen = 0;
  private minuteVals = new Map<number, number>();
  private medCache: { minute: number; val: number | null } = { minute: -1, val: null };
  private high = -Infinity;
  private low = Infinity;
  private prevStatus: Status = "NETRAL";
  private lastBigLot: number | null = null;
  sessionTrades = 0;
  lastTradeTs: number | null = null;
  lastPrice: number | null = null;
  chgPct: number | null = null;
  stars = 0;

  constructor(
    readonly code: string,
    private cfg: Thresholds,
    private mode: ModeKey,
    private brokers: BrokerMap,
    private clusterer: Clusterer,
  ) {
    const ws = cfg.modes[mode].windowsSec;
    this.windows = new WindowSet(ws);
    this.roles = [labelFor(ws[0]!), labelFor(ws[1]!), labelFor(ws[2]!)];
    this.big = new BigLotThreshold(cfg.bigLot);
    this.lc = new LifecycleTracker(cfg.lifecycle);
    this.sc = new SideChangeTracker(cfg.status.sideChange);
    const mid = ws[1]! * 1000;
    this.party = { FOREIGN: new RollingWindow(mid), LOCAL_INST: new RollingWindow(mid), RETAIL: new RollingWindow(mid) };
    this.sessParty = { FOREIGN: new RollingWindow(Infinity), LOCAL_INST: new RollingWindow(Infinity), RETAIL: new RollingWindow(Infinity) };
  }

  /** Proses satu trade. Mengembalikan BigEvent jika trade/cluster ini tergolong lot besar. */
  process(t: Trade, chgPct?: number | null): BigEvent | null {
    if (t.board !== "RG") return null;
    this.sessionTrades++;
    this.lastTradeTs = Math.max(this.lastTradeTs ?? 0, t.ts);
    this.lastPrice = t.price;
    if (chgPct != null) this.chgPct = chgPct;
    this.high = Math.max(this.high, t.price);
    this.low = Math.min(this.low, t.price);
    this.vwapNum += t.price * t.lot;
    this.vwapDen += t.lot;
    const minute = Math.floor(t.ts / 60000);
    this.minuteVals.set(minute, (this.minuteVals.get(minute) ?? 0) + t.value);

    const thr = this.big.threshold(t.price, this.cfg.modes[this.mode].minBigValue);
    this.lastBigLot = thr;
    this.windows.addTrade(t.ts, t.side, t.value);
    this.lc.addTrade(t.price, t.lot, t.side);

    for (const [who, broker, type, side] of [
      ["buyer", t.buyerBroker, t.buyerType, "BUY"],
      ["seller", t.sellerBroker, t.sellerType, "SELL"],
    ] as const) {
      void who;
      if (broker || type) this.brokerSeen = true;
      const cls = this.brokers.classify(broker, type);
      if (cls !== "UNKNOWN") {
        this.party[cls].addTrade(t.ts, side, t.value);
        this.sessParty[cls].addTrade(t.ts, side, t.value);
      }
    }

    const cl = this.clusterer.add(t);
    let bigValue = 0;
    let bigLot = t.lot;
    let trades = 1;
    if (t.lot >= thr) bigValue = t.value;
    if (cl && !cl.isNew && cl.cluster.lot >= thr) {
      const before = cl.cluster.lot - t.lot;
      bigValue = before < thr ? cl.cluster.value : t.value; // cluster baru melewati ambang: hitung seluruh cluster
      bigLot = cl.cluster.lot;
      trades = cl.cluster.trades;
    }
    this.big.push(t.lot);

    if (bigValue > 0 && t.side !== "UNKNOWN") {
      this.windows.addBig(t.ts, t.side, bigValue);
      this.sc.addBig(t.ts, t.side);
      return {
        ts: t.ts, code: t.code, price: t.price, lot: bigLot, value: bigValue, side: t.side,
        clusterValue: cl ? Math.max(cl.cluster.value, t.value) : t.value, clusterId: cl ? cl.cluster.id : null,
        superBig: isSuperBig(bigLot, cl ? cl.cluster.value : t.value, thr, this.cfg.bigLot), trades,
        buyer: t.buyerBroker, seller: t.sellerBroker, buyerType: t.buyerType, sellerType: t.sellerType,
      };
    }
    return null;
  }

  onSnapshot(s: BookSnapshot): void {
    const price = s.last ?? this.lastPrice ?? s.bids[0]?.price ?? 0;
    const minBig = price > 0 ? this.big.threshold(price, this.cfg.modes[this.mode].minBigValue) : 0;
    this.lc.onSnapshot(s, minBig);
    if (this.lastPrice === null && s.last != null) this.lastPrice = s.last;
  }

  private medianMinute(now: number): number | null {
    const minute = Math.floor(now / 60000);
    if (this.medCache.minute !== minute) {
      // Menit berjalan tidak dihitung (belum lengkap), kecuali hanya itu yang ada.
      const vals = [...this.minuteVals.entries()].filter(([m]) => m < minute).map(([, v]) => v);
      this.medCache = { minute, val: median(vals.length ? vals : [...this.minuteVals.values()]) };
    }
    return this.medCache.val;
  }

  evaluate(now: number, parserPct: number | null): EmitenView {
    const all = this.windows.metrics(now);
    const m: RoleMetrics = { short: all[this.roles[0]]!, mid: all[this.roles[1]]!, long: all[this.roles[2]]! };
    const snap = this.lc.snapshot;
    const price = this.lastPrice ?? snap?.last ?? null;
    const vwap = this.vwapDen > 0 ? this.vwapNum / this.vwapDen : null;
    const vwapDist = price !== null && vwap ? (price - vwap) / vwap : null;
    const depth = snap ? depthRatio(snap) : null;
    const flags = this.lc.flags(now);

    const status = computeStatus(
      { m, flowKuatAggrFlow: this.cfg.modes[this.mode].flowKuatAggrFlow, vwapDist, bidBertahan: flags.bidBertahan },
      this.cfg.status,
    );
    if (status === "FLOW KUAT" && this.prevStatus !== "FLOW KUAT") this.stars++;
    this.prevStatus = status;
    const candidate: FlowSide | null = status === "FLOW KUAT" || status === "PADA BELI" ? "BELI" : status === "PADA JUALAN" ? "JUAL" : null;
    this.sc.update(now, candidate);

    const Q = quality(this.sessionTrades, this.lastTradeTs, now, parserPct, this.cfg.quality);
    const med = this.medianMinute(now);
    const pm = (k: keyof typeof this.party, sess = false) => (sess ? this.sessParty : this.party)[k].metrics(now).aggrFlow;
    const party = this.brokerSeen
      ? {
          foreign: pm("FOREIGN"), localInst: pm("LOCAL_INST"), retail: pm("RETAIL"),
          sessForeign: pm("FOREIGN", true), sessLocalInst: pm("LOCAL_INST", true), sessRetail: pm("RETAIL", true),
        }
      : null;
    const vLabel = vwapLabel(vwapDist, this.cfg.vwap);
    const nearAra = !!(snap?.ara && price !== null && price >= snap.ara - 2 * tickSize(price));
    const midTotal = m.mid.buyValue + m.mid.sellValue + m.mid.unknownValue;

    const score = computeScore(
      {
        buyPct: m.mid.buyPct,
        aggrFlow: m.mid.aggrFlow,
        aggrFlowScale: med !== null ? med * this.cfg.score.aggrFlowNormMinutes : null,
        bigNet: m.mid.bigNet,
        totalValue: midTotal,
        instNet: party ? party.foreign + party.localInst : null,
        lifecycle: this.lc.score(now, depth !== null && depth >= 0.8),
        q: Q.q,
        bidDitarik: flags.bidDitarik,
        refillOffer: flags.refillOffer,
        nearAra,
        vwapTooFar: vLabel === "TERLALU JAUH",
      },
      this.cfg.score,
    );

    return {
      code: this.code, price, chgPct: this.chgPct, roles: this.roles, m, status,
      rame: rameLabel(m.mid, this.cfg.status), q: Q.q, qLabel: Q.label, score, stars: this.stars,
      warn: this.low < Infinity && this.low > 0 && (this.high - this.low) / this.low > this.cfg.status.volatilityWarn,
      vwap, vwapDist, vwapLabel: vLabel, bigLot: this.lastBigLot,
      sideChange: this.sc.last, sidePending: this.sc.pending,
      lifecycle: this.lc.recent(now), flags, depth, party,
      sessionTrades: this.sessionTrades, lastTradeTs: this.lastTradeTs,
    };
  }
}

/** Kumpulan mesin per emiten untuk satu mode. */
export class RadarEngine {
  private engines = new Map<string, EmitenEngine>();
  private clusterer: Clusterer;
  readonly recentBig: BigEvent[] = [];

  constructor(private cfg: Thresholds, readonly mode: ModeKey, private brokers: BrokerMap) {
    this.clusterer = new Clusterer(cfg.bigLot);
  }

  get(code: string): EmitenEngine {
    let e = this.engines.get(code);
    if (!e) this.engines.set(code, (e = new EmitenEngine(code, this.cfg, this.mode, this.brokers, this.clusterer)));
    return e;
  }

  ingestTrade(t: Trade, chgPct?: number | null): BigEvent | null {
    const ev = this.get(t.code).process(t, chgPct);
    if (ev) {
      // Satu cluster = satu baris: perbarui entri lama milik cluster yang sama.
      if (ev.clusterId !== null) {
        const i = this.recentBig.findIndex((b) => b.code === ev.code && b.clusterId === ev.clusterId);
        if (i >= 0) this.recentBig.splice(i, 1);
      }
      this.recentBig.unshift(ev);
      if (this.recentBig.length > 50) this.recentBig.length = 50;
    }
    return ev;
  }

  ingestSnapshot(s: BookSnapshot): void {
    this.get(s.code).onSnapshot(s);
  }

  /** Semua emiten yang punya trade RG, diurutkan skor tertinggi. */
  views(now: number, parserPct: number | null): EmitenView[] {
    const out: EmitenView[] = [];
    for (const e of this.engines.values()) if (e.sessionTrades > 0) out.push(e.evaluate(now, parserPct));
    return out.sort((a, b) => b.score.score - a.score.score);
  }
}
