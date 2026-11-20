// Radar-3 value model, validation harness, farm economics and funnel.
// Everything here is derived at run time from the sealed snapshot: no
// protocol name is special-cased, and every fitted number is recomputed
// from the traded anchors on each run, so the program stays deterministic
// and honest about what it measured.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export const EXCLUDED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);

const VERSIONED_NAME = / (V\d+|v\d+|\d+\.\d+.*)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

export function isTradedAnchor(p: Protocol): boolean {
  // mcap_usd of -1 is DefiLlama's placeholder for "token trades but the
  // market cap is unknown": it cannot anchor a value fit, so it is dropped.
  return p.mcap_usd != null && p.mcap_usd > 0 && p.gecko_id != null && p.symbol != null;
}

export function isPretoken(p: Protocol): boolean {
  return p.mcap_usd == null && p.gecko_id == null && p.symbol == null;
}

export function exclusionReason(p: Protocol): string | null {
  if (p.category != null && EXCLUDED_CATEGORIES.has(p.category)) return "category " + p.category;
  if (VERSIONED_NAME.test(p.name)) return "versioned name";
  if (WRAPPED_WORD.test(p.name)) return "wrapped or staked product";
  if (EXCHANGE_PREFIX.some((e) => p.name.startsWith(e))) return "exchange product";
  return null;
}

export function isRankable(p: Protocol): boolean {
  return isPretoken(p) && exclusionReason(p) == null;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[i];
}

// --- Small OLS solver (normal equations + Gauss elimination) ---
export function ols(rows: number[][], y: number[]): number[] {
  const k = rows[0].length;
  const a: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  const b: number[] = Array(k).fill(0);
  for (let i = 0; i < rows.length; i++) {
    for (let x = 0; x < k; x++) {
      b[x] += rows[i][x] * y[i];
      for (let c = 0; c < k; c++) a[x][c] += rows[i][x] * rows[i][c];
    }
  }
  const m = a.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    [m[c], m[piv]] = [m[piv], m[c]];
    const d = m[c][c];
    for (let j = c; j <= k; j++) m[c][j] /= d;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = m[r][c];
      for (let j = c; j <= k; j++) m[r][j] -= f * m[c][j];
    }
  }
  return m.map((r) => r[k]);
}

// Huber-weighted fit (IRLS, c = 1.345): a few huge outliers must not drag
// the curve, because the anchor set spans six orders of magnitude.
export function huberFit(rows: number[][], y: number[], iters = 12): number[] {
  let beta = ols(rows, y);
  const c = 1.345;
  for (let it = 0; it < iters; it++) {
    const res = rows.map((r, i) => y[i] - r.reduce((s, v, j) => s + v * beta[j], 0));
    const s = 1.4826 * median(res.map(Math.abs));
    const w = res.map((r) => (Math.abs(r) <= c * s ? 1 : (c * s) / Math.abs(r)));
    const wr = rows.map((r, i) => r.map((v) => v * Math.sqrt(w[i])));
    const wy = y.map((v, i) => v * Math.sqrt(w[i]));
    beta = ols(wr, wy);
  }
  return beta;
}

export interface CurveFit {
  intercept: number;
  slope: number;
  center: number;
  anchors: number;
}

export function fitCurve(anchors: Protocol[]): CurveFit {
  const center = anchors.reduce((s, p) => s + Math.log(p.tvl_usd), 0) / anchors.length;
  const rows = anchors.map((p) => [1, Math.log(p.tvl_usd) - center]);
  const y = anchors.map((p) => Math.log(p.mcap_usd as number));
  const beta = huberFit(rows, y);
  return { intercept: beta[0], slope: beta[1], center, anchors: anchors.length };
}

export function predictImplied(fit: CurveFit, tvl: number): number {
  return Math.max(1, Math.round(Math.exp(fit.intercept + fit.slope * (Math.log(tvl) - fit.center))));
}

// --- Blind validation: leave-one-out and walk-forward median miss ---
// "Miss" is multiplicative: exp(median |log error|). A miss of x3.5 means the
// typical prediction is within a factor 3.5 of the real market cap.
export function looMiss(anchors: Protocol[]): number {
  const errs: number[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const train = anchors.filter((_, j) => j !== i);
    const fit = fitCurve(train);
    errs.push(Math.abs(Math.log(anchors[i].mcap_usd as number) - Math.log(predictImplied(fit, anchors[i].tvl_usd))));
  }
  return Math.exp(median(errs));
}

export function looResiduals(anchors: Protocol[]): number[] {
  const res: number[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const train = anchors.filter((_, j) => j !== i);
    const fit = fitCurve(train);
    res.push(Math.log(anchors[i].mcap_usd as number) - Math.log(predictImplied(fit, anchors[i].tvl_usd)));
  }
  return res.sort((a, b) => a - b);
}

export function walkForwardMiss(anchors: Protocol[], reverse: boolean): number {
  const dated = anchors
    .filter((p) => p.listed_at)
    .sort((a, b) => (a.listed_at as string) < (b.listed_at as string) ? -1 : 1);
  const cut = Math.floor(dated.length * 0.6);
  const train = reverse ? dated.slice(dated.length - cut) : dated.slice(0, cut);
  const test = reverse ? dated.slice(0, dated.length - cut) : dated.slice(cut);
  const fit = fitCurve(train);
  const errs = test.map((p) => Math.abs(Math.log(p.mcap_usd as number) - Math.log(predictImplied(fit, p.tvl_usd))));
  return Math.exp(median(errs));
}

// Flat multiple baseline, leave-one-out: per-category median mcap/TVL
// (min 3 comps, else the global median), clamped to 0.05-1.00.
export function flatMultipleMiss(anchors: Protocol[]): number {
  const errs: number[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const p = anchors[i];
    const rest = anchors.filter((_, j) => j !== i);
    const same = rest.filter((q) => (q.category || "none") === (p.category || "none"));
    const mult =
      same.length >= 3
        ? median(same.map((q) => (q.mcap_usd as number) / q.tvl_usd))
        : median(rest.map((q) => (q.mcap_usd as number) / q.tvl_usd));
    const m = Math.min(1, Math.max(0.05, mult));
    errs.push(Math.abs(Math.log(p.mcap_usd as number) - Math.log(p.tvl_usd * m)));
  }
  return Math.exp(median(errs));
}

// The radar-2 model, scored the same blind way: flat multiple times a
// 7-day-growth multiplier and a maturity multiplier. Kept so the dashboard
// can show, honestly, that the old model measured worse out of sample.
export function oldModelMiss(anchors: Protocol[], asOf: string): number {
  const errs: number[] = [];
  const asOfMs = Date.parse(asOf + "T00:00:00Z");
  for (let i = 0; i < anchors.length; i++) {
    const p = anchors[i];
    const rest = anchors.filter((_, j) => j !== i);
    const same = rest.filter((q) => (q.category || "none") === (p.category || "none"));
    let mult =
      same.length >= 3
        ? median(same.map((q) => (q.mcap_usd as number) / q.tvl_usd))
        : median(rest.map((q) => (q.mcap_usd as number) / q.tvl_usd));
    mult = Math.min(1, Math.max(0.05, mult));
    const g = p.change_7d == null ? 0 : Math.min(120, Math.max(-60, p.change_7d)) / 100;
    const growthMult = 1 + g * 0.5;
    const age = p.listed_at ? Math.max(0, (asOfMs - Date.parse(p.listed_at + "T00:00:00Z")) / 86400000) : 365;
    const maturityMult = 0.6 + (Math.min(age, 1095) / 1095) * 0.4;
    const imp = Math.max(1, Math.round(p.tvl_usd * mult * growthMult * maturityMult));
    errs.push(Math.abs(Math.log(p.mcap_usd as number) - Math.log(imp)));
  }
  return Math.exp(median(errs));
}

// Candidate extra terms, tested and dropped: 7-day growth, age without a
// token, and chain count each made the leave-one-out miss WORSE, so the
// shipped model keeps none of them. The test lives in main.ts output as
// the validation table; the terms are not in the model.
export function spearman(xs: number[], ys: number[]): number {
  const ranks = (a: number[]): number[] => {
    const s = a.map((v, i) => [v, i] as [number, number]).sort((x, y) => x[0] - y[0]);
    const r = new Array(a.length).fill(0);
    let i = 0;
    while (i < s.length) {
      let j = i;
      while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[s[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = xs.length;
  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

// --- Farm economics (P2) ---
// Gas is a typical per-transaction cost in USD, November 2026 estimates,
// stated as estimates on the page. A 12-week plan uses 16 transactions:
// 2 to set up, 1 a week for 12 weeks, 2 to exit.
export const GAS_PER_TX: Record<string, number> = {
  Ethereum: 8.0,
  Base: 0.05,
  Arbitrum: 0.1,
  Optimism: 0.05,
  Solana: 0.01,
  Binance: 0.15,
  Avalanche: 0.3,
  Polygon: 0.05,
  "Hyperliquid L1": 0.01,
  Monad: 0.01,
  Plasma: 0.05,
  "Robinhood Chain": 0.05,
};
export const DEFAULT_GAS_PER_TX = 0.5;
export const PLAN_WEEKS = 12;
export const PLAN_TXS = 16;

export function gasPerTx(chain: string): number {
  return GAS_PER_TX[chain] ?? DEFAULT_GAS_PER_TX;
}

export function depositFor(tvl: number): number {
  if (tvl < 100_000_000) return 100;
  if (tvl < 1_000_000_000) return 250;
  return 500;
}

export interface FarmPlan {
  deposit: number;
  chain: string;
  gasPerTx: number;
  gasTotal: number;
  allocBase: number;
  netBase: number;
  verdict: "FARM" | "MARGINAL" | "SKIP";
}

// Expected allocation is a scenario, not a promise: the base case assumes
// the farmer's eventual allocation is worth 0.001% of the implied value.
// The verdict is the base-case net against the plan's gas cost.
export function farmPlan(implied: number, tvl: number, chain: string): FarmPlan {
  const deposit = depositFor(tvl);
  const g = gasPerTx(chain);
  const gasTotal = +(PLAN_TXS * g).toFixed(2);
  const allocBase = +(implied * 0.00001).toFixed(2);
  const netBase = +(allocBase - gasTotal).toFixed(2);
  const verdict = netBase > 50 ? "FARM" : netBase > 0 ? "MARGINAL" : "SKIP";
  return { deposit, chain, gasPerTx: g, gasTotal, allocBase, netBase, verdict };
}

// Sensitivity matrix: drop-share scenario x deposit size. Net = implied x
// share x (deposit / 250) - gas total. The $250 column is the plan's own
// deposit scale, so its middle cell is the base case.
export const SHARE_SCENARIOS = [0.000005, 0.00001, 0.00005];
export const DEPOSIT_SCENARIOS = [100, 250, 500];

export function sensitivityNet(implied: number, gasTotal: number, share: number, deposit: number): number {
  return +(implied * share * (deposit / 250) - gasTotal).toFixed(2);
}

export function categoryAction(category: string | null): { main: string; weekly: string } {
  switch (category) {
    case "Lending":
    case "CDP":
      return { main: "supply stablecoins into the lending market", weekly: "top up the supply and claim any points" };
    case "Dexs":
    case "Yield":
      return { main: "add liquidity to the main pool", weekly: "collect the fees and add them back to the pool" };
    case "Risk Curators":
    case "Onchain Capital Allocator":
      return { main: "deposit into a curated vault", weekly: "check the vault allocation and top it up" };
    case "RWA":
      return { main: "mint a tokenised position", weekly: "top up the position and log the points" };
    case "Derivatives":
    case "Basis Trading":
      return { main: "open a small hedged position", weekly: "check the hedge and rebalance it" };
    default:
      return { main: "deposit into the protocol's main pool", weekly: "top up the position and log the points" };
  }
}

export function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return "$" + (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}

export function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Six concrete steps, each carrying this row's own numbers. The dashboard
// renders the same steps from the same fields, so board and page agree.
export function farmSteps(p: Protocol, implied: number, plan: FarmPlan, asOf: string): string[] {
  const act = categoryAction(p.category);
  const base = Date.parse(asOf + "T00:00:00Z");
  const week6 = fmtDate(new Date(base + 42 * 86400000));
  const week12 = fmtDate(new Date(base + 84 * 86400000));
  const gas = "$" + plan.gasPerTx.toFixed(2);
  return [
    `Set up a fresh wallet on ${plan.chain} and bridge in $${plan.deposit} plus about ${gas} for the first transaction.`,
    `Deposit $${plan.deposit} to ${act.main} on ${p.name} (${plan.chain}); keep the receipt hash in a farm log.`,
    `Every week for ${PLAN_WEEKS} weeks, ${act.weekly} (about ${gas} of gas each week, $${(plan.gasPerTx * PLAN_WEEKS).toFixed(2)} in total).`,
    `Check the protocol's official points page each week and write down the points balance; no points page means no farming signal.`,
    `Review on ${week6}: if TVL has fallen by half or the points page is gone, exit early instead of waiting out the plan.`,
    `Exit on ${week12}: withdraw the $${plan.deposit} deposit. Total gas about $${plan.gasTotal.toFixed(2)}; base-case allocation ${fmtUsd(plan.allocBase)}, net ${fmtUsd(plan.netBase)} (${plan.verdict}).`,
  ];
}

// Three nearest traded anchors by |log TVL gap|, same category first.
export function nearestComparables(p: Protocol, anchors: Protocol[]): Protocol[] {
  const scored = anchors.map((a) => ({
    a,
    gap: Math.abs(Math.log(a.tvl_usd) - Math.log(p.tvl_usd)) + ((a.category || "none") === (p.category || "none") ? 0 : 0.5),
  }));
  scored.sort((x, y) => (x.gap - y.gap) || (x.a.slug < y.a.slug ? -1 : 1));
  return scored.slice(0, 3).map((s) => s.a);
}

// Funnel (P3): every one of the 758 protocols accounted for, in one
// partition that sums exactly. Reasons are counted first-match so no
// protocol is counted twice.
export interface Funnel {
  total: number;
  ranked: number;
  pretokenExcluded: number;
  tradedAnchors: number;
  tokenPriceless: number;
  excludedByReason: [string, number][];
}

export function funnel(snap: Snapshot): Funnel {
  const byReason = new Map<string, number>();
  let ranked = 0;
  let pretokenExcluded = 0;
  let tradedAnchors = 0;
  let tokenPriceless = 0;
  for (const p of snap.protocols) {
    if (isRankable(p)) {
      ranked++;
    } else if (isPretoken(p)) {
      pretokenExcluded++;
      const r = exclusionReason(p) as string;
      byReason.set(r, (byReason.get(r) || 0) + 1);
    } else if (isTradedAnchor(p)) {
      tradedAnchors++;
    } else {
      tokenPriceless++;
    }
  }
  return {
    total: snap.protocols.length,
    ranked,
    pretokenExcluded,
    tradedAnchors,
    tokenPriceless,
    excludedByReason: [...byReason].sort((a, b) => b[1] - a[1]),
  };
}
