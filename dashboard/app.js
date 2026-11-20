// Token Radar radar-3 dashboard. All data comes from data.js; nothing is
// fetched. Rows arrive as compact positional arrays with shared tables
// (see main.ts); this file decodes them and recomputes the derived
// figures (band, deposit, gas, allocation, net, verdict) from the same
// rules main.ts uses for board.json, so board and page agree.
const D = window.RADAR_DATA;
const V = D.validation;
const $ = (id) => document.getElementById(id);

function fmtUsd(n) {
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}
function fmtDate(d) { return d.toISOString().slice(0, 10); }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// Typical per-transaction gas in USD (November 2026 estimates), same table
// as the model. A 12-week plan uses 16 transactions.
const GAS = { Ethereum: 8, Base: 0.05, Arbitrum: 0.1, Optimism: 0.05, Solana: 0.01, Binance: 0.15, Avalanche: 0.3, Polygon: 0.05, "Hyperliquid L1": 0.01, Monad: 0.01, Plasma: 0.05, "Robinhood Chain": 0.05 };
function depositFor(tvl) { return tvl < 1e8 ? 100 : tvl < 1e9 ? 250 : 500; }
function farmPlanFor(tvl, imp, chain) {
  const dep = depositFor(tvl);
  const gas = +(16 * (GAS[chain] ?? 0.5)).toFixed(2);
  const alloc = +(imp * 0.00001).toFixed(2);
  const net = +(alloc - gas).toFixed(2);
  const verdict = net > 50 ? "FARM" : net > 0 ? "MARGINAL" : "SKIP";
  return { dep, chain, gas, alloc, net, verdict };
}

// Row: [slug, name, catIdx|null, [chainIdx], tvl, g7, imp, wl, [compSlugs]]
function decodeRow(a, i) {
  const chains = a[3].map((j) => D.chains[j]);
  const plan = farmPlanFor(a[4], a[6], chains[0] || "Ethereum");
  return {
    rank: i + 1, slug: a[0], name: a[1], cat: a[2] == null ? null : D.cats[a[2]],
    chains, tvl: a[4], g7: a[5], imp: a[6], wl: !!a[7],
    comps: a[8].map((s) => ({ slug: s, name: D.anchors[s][0], tvl: D.anchors[s][1], mcap: D.anchors[s][2] })),
    chain: plan.chain, dep: plan.dep, gas: plan.gas, alloc: plan.alloc, net: plan.net, verdict: plan.verdict,
    lo: Math.max(1, Math.round(a[6] * Math.exp(V.bandP25))),
    hi: Math.round(a[6] * Math.exp(V.bandP75)),
  };
}
// Live row: [slug, name, catIdx|null, [chainIdx], tvl, mcap, g7]
function decodeLive(a, i) {
  return { rank: i + 1, slug: a[0], name: a[1], cat: a[2] == null ? null : D.cats[a[2]], chains: a[3].map((j) => D.chains[j]), tvl: a[4], imp: a[5], g7: a[6], lo: null, hi: null, verdict: "—", net: null, wl: false };
}

function categoryAction(cat) {
  switch (cat) {
    case "Lending": case "CDP":
      return { main: "supply stablecoins into the lending market", weekly: "top up the supply and claim any points" };
    case "Dexs": case "Yield":
      return { main: "add liquidity to the main pool", weekly: "collect the fees and add them back to the pool" };
    case "Risk Curators": case "Onchain Capital Allocator":
      return { main: "deposit into a curated vault", weekly: "check the vault allocation and top it up" };
    case "RWA":
      return { main: "mint a tokenised position", weekly: "top up the position and log the points" };
    case "Derivatives": case "Basis Trading":
      return { main: "open a small hedged position", weekly: "check the hedge and rebalance it" };
    default:
      return { main: "deposit into the protocol's main pool", weekly: "top up the position and log the points" };
  }
}

// Same rule as main.ts: six steps carrying this row's own numbers.
function farmSteps(row) {
  const act = categoryAction(row.cat);
  const base = Date.parse(D.asOf + "T00:00:00Z");
  const week6 = fmtDate(new Date(base + 42 * 86400000));
  const week12 = fmtDate(new Date(base + 84 * 86400000));
  const gtx = row.gas / 16;
  const gas = "$" + gtx.toFixed(2);
  return [
    "Set up a fresh wallet on " + row.chain + " and bridge in $" + row.dep + " plus about " + gas + " for the first transaction.",
    "Deposit $" + row.dep + " to " + act.main + " on " + row.name + " (" + row.chain + "); keep the receipt hash in a farm log.",
    "Every week for 12 weeks, " + act.weekly + " (about " + gas + " of gas each week, $" + (gtx * 12).toFixed(2) + " in total).",
    "Check the protocol's official points page each week and write down the points balance; no points page means no farming signal.",
    "Review on " + week6 + ": if TVL has fallen by half or the points page is gone, exit early instead of waiting out the plan.",
    "Exit on " + week12 + ": withdraw the $" + row.dep + " deposit. Total gas about $" + row.gas.toFixed(2) + "; base-case allocation " + fmtUsd(row.alloc) + ", net " + fmtUsd(row.net) + " (" + row.verdict + ").",
  ];
}

function impliedAt(tvl, slope, centre) {
  return Math.max(1, Math.round(Math.exp(V.intercept + slope * (Math.log(tvl) - centre))));
}

if (typeof module !== "undefined") {
  module.exports = { farmSteps, fmtUsd, impliedAt, categoryAction, decodeRow, decodeLive, farmPlanFor };
}

if (typeof document !== "undefined") {
  const ROWS = D.rows.map(decodeRow);
  const LIVE = D.live.map(decodeLive);

  // --- KPI strip ---
  $("kpis").innerHTML = [
    [ROWS.length, "protocols ranked"],
    [D.watchlistCovered + "/" + D.watchlistTotal, "watchlist covered"],
    ["×" + V.loo.toFixed(2), "leave-one-out median miss"],
    [fmtUsd(V.topImplied), "top implied value"],
    [fmtUsd(V.totalImplied), "total implied value"],
    [V.verdicts.FARM + " / " + V.verdicts.MARGINAL + " / " + V.verdicts.SKIP, "FARM / MARGINAL / SKIP verdicts"],
  ].map(([b, s]) => '<div class="kpi"><b>' + b + "</b><span>" + s + "</span></div>").join("");

  // --- Funnel ---
  const F = D.funnel;
  const bars = [
    ["Ranked on the board", F.ranked, false],
    ["Pre-token, excluded with a reason", F.pretokenExcluded, true],
    ["Token already trades (anchors)", F.tradedAnchors, true],
    ["Token recorded, market cap unpriced", F.tokenPriceless, true],
  ];
  $("funnel").innerHTML = bars.map(([lbl, n, dim]) =>
    '<div class="bar-row"><span class="lbl">' + lbl + " — <b>" + n + "</b></span>" +
    '<div class="bar' + (dim ? " dim" : "") + '" style="width:' + Math.max(2, (n / F.total) * 100) + '%"></div></div>').join("") +
    "<p>Total: <b>" + F.total + "</b> protocols. " + F.ranked + " + " + F.pretokenExcluded + " + " + F.tradedAnchors + " + " + F.tokenPriceless + " = " + F.total + ".</p>";
  $("excluded").innerHTML = "<p>Excluded pre-token protocols, by first reason: " +
    F.excludedByReason.map(([r, n]) => esc(r) + " (" + n + ")").join(" · ") + ".</p>";

  // --- Filters ---
  $("cat").innerHTML = '<option value="">All categories</option>' + D.cats.map((c) => "<option>" + esc(c) + "</option>").join("");
  $("chain").innerHTML = '<option value="">All chains</option>' + D.chains.map((c) => "<option>" + esc(c) + "</option>").join("");

  let mode = "pre";
  let sortKey = "rank";
  let sortDir = 1;

  function viewRows() {
    if (mode === "live") return LIVE;
    let rows = ROWS;
    const q = $("q").value.trim().toLowerCase();
    if (q) rows = rows.filter((r) => (r.name + " " + r.slug).toLowerCase().includes(q));
    const c = $("cat").value;
    if (c) rows = rows.filter((r) => r.cat === c);
    const ch = $("chain").value;
    if (ch) rows = rows.filter((r) => r.chains.includes(ch));
    return rows;
  }

  function render() {
    const rows = [...viewRows()];
    const key = sortKey;
    rows.sort((a, b) => {
      const va = a[key], vb = b[key];
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string") return sortDir * va.localeCompare(vb);
      return sortDir * (va - vb);
    });
    $("rows").innerHTML = rows.map((r) => {
      const band = r.lo == null ? "—" : fmtUsd(r.lo) + " – " + fmtUsd(r.hi);
      const net = r.net == null ? "—" : fmtUsd(r.net);
      const wl = r.wl ? ' <span class="badge wl">WATCHLIST</span>' : "";
      return "<tr data-slug=\"" + esc(r.slug) + "\"><td class=\"num\">" + r.rank + "</td><td>" + esc(r.name) + wl + "</td><td>" +
        esc(r.cat || "—") + "</td><td class=\"num\">" + fmtUsd(r.tvl) + "</td><td class=\"num\">" + fmtUsd(r.imp) + "</td><td class=\"num\">" +
        band + "</td><td class=\"v-" + r.verdict + "\">" + r.verdict + "</td><td class=\"num\">" + net + "</td></tr>";
    }).join("");
    $("count").textContent = rows.length + (mode === "pre" ? " pre-token protocols" : " live tokens by market cap");
    document.querySelectorAll("#rows tr").forEach((tr) => tr.addEventListener("click", () => openDetail(tr.dataset.slug)));
  }

  document.querySelectorAll("#board th").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.k;
    if (sortKey === k) sortDir = -sortDir;
    else { sortKey = k; sortDir = 1; }
    render();
  }));
  ["q", "cat", "chain"].forEach((id) => $(id).addEventListener("input", render));
  $("tab-pre").addEventListener("click", () => { mode = "pre"; $("tab-pre").classList.add("on"); $("tab-live").classList.remove("on"); render(); });
  $("tab-live").addEventListener("click", () => { mode = "live"; $("tab-live").classList.add("on"); $("tab-pre").classList.remove("on"); render(); });

  // --- Detail view ---
  function openDetail(slug) {
    const row = ROWS.find((r) => r.slug === slug);
    if (!row) return;
    const recomputed = impliedAt(row.tvl, V.slope, V.center);
    const match = recomputed === row.imp ? "✓ matches board" : "✗ differs from board";
    const typical = row.tvl * V.globalMedianMultiple;
    const sens = D.shares.map((sh) =>
      "<tr><td>" + (sh * 100).toFixed(4) + "%</td>" + D.deposits.map((dep) =>
        "<td>" + fmtUsd(row.imp * sh * (dep / 250) - row.gas) + "</td>").join("") + "</tr>").join("");
    $("detail-body").innerHTML =
      "<h3>" + esc(row.name) + (row.wl ? ' <span class="badge wl">WATCHLIST</span>' : "") + "</h3>" +
      "<p>" + esc(row.cat || "Uncategorised") + " · " + row.chains.map(esc).join(", ") + " · rank #" + row.rank + "</p>" +
      "<table><tbody>" +
      "<tr><td>TVL</td><td class=\"num\">" + fmtUsd(row.tvl) + "</td></tr>" +
      "<tr><td>7-day TVL change</td><td class=\"num\">" + (row.g7 == null ? "—" : row.g7.toFixed(1) + "%") + "</td></tr>" +
      "<tr><td>Implied value</td><td class=\"num\"><b>" + fmtUsd(row.imp) + "</b></td></tr>" +
      "<tr><td>P25–P75 band</td><td class=\"num\">" + fmtUsd(row.lo) + " – " + fmtUsd(row.hi) + "</td></tr>" +
      "<tr><td>Farm deposit</td><td class=\"num\">$" + row.dep + " on " + esc(row.chain) + "</td></tr>" +
      "<tr><td>Plan gas (16 tx)</td><td class=\"num\">$" + row.gas.toFixed(2) + "</td></tr>" +
      "<tr><td>Base-case allocation</td><td class=\"num\">" + fmtUsd(row.alloc) + "</td></tr>" +
      "<tr><td>Base-case net</td><td class=\"num\"><b>" + fmtUsd(row.net) + "</b> · <span class=\"v-" + row.verdict + "\">" + row.verdict + "</span></td></tr>" +
      "</tbody></table>" +
      "<p><strong>Value bridge.</strong> At the median traded multiple (" + V.globalMedianMultiple.toFixed(3) + ") this TVL would imply " + fmtUsd(typical) +
      ". The fitted size curve adjusts that to <b>" + fmtUsd(row.imp) + "</b> — a factor of " + (row.imp / typical).toFixed(2) +
      " — because value grows slower than TVL (slope " + V.slope.toFixed(2) + "). Recomputed from the curve: " + fmtUsd(recomputed) + " (" + match + ").</p>" +
      "<h4>Nearest traded comparables</h4><table><thead><tr><th>Protocol</th><th>TVL</th><th>Market cap</th><th>Multiple</th></tr></thead><tbody>" +
      row.comps.map((c) => "<tr><td>" + esc(c.name) + "</td><td class=\"num\">" + fmtUsd(c.tvl) + "</td><td class=\"num\">" + fmtUsd(c.mcap) + "</td><td class=\"num\">" + (c.mcap / c.tvl).toFixed(3) + "</td></tr>").join("") +
      "</tbody></table>" +
      "<h4>Farm plan — 12 weeks, costed</h4><ol class=\"steps\">" +
      farmSteps(row).map((s) => "<li>" + esc(s) + "</li>").join("") + "</ol>" +
      "<h4>Sensitivity — net USD by drop share × deposit</h4>" +
      "<table class=\"sens\"><thead><tr><th>Drop share</th>" + D.deposits.map((d) => "<th>$" + d + "</th>").join("") + "</tr></thead><tbody>" + sens + "</tbody></table>" +
      "<p class=\"hint\">Drop share is a scenario for the farmer's allocation as a fraction of implied value, not a promise. The middle column ($250) is the plan's own deposit scale.</p>";
    $("detail").showModal();
    $("detail").scrollTop = 0;
  }
  $("detail-close").addEventListener("click", () => $("detail").close());

  // --- Validation table ---
  const vrows = [
    ["Leave-one-out, size curve", "×" + V.loo.toFixed(2), "Refit 128 times, predict the one left out"],
    ["Walk-forward, oldest → newest", "×" + V.walkForward.toFixed(2), "Fit oldest 60%, predict newest 40%"],
    ["Walk-forward, newest → oldest", "×" + V.walkForwardReverse.toFixed(2), "The same split, reversed"],
    ["Leave-one-out, flat multiple", "×" + V.flatLoo.toFixed(2), "Per-category median mcap/TVL"],
    ["Leave-one-out, old radar-2 model", "×" + V.oldLoo.toFixed(2), "Flat multiple × growth × maturity"],
  ];
  $("valid-rows").innerHTML = vrows.map((r) => "<tr><td>" + r[0] + "</td><td class=\"num\"><b>" + r[1] + "</b></td><td>" + r[2] + "</td></tr>").join("");
  $("method").insertAdjacentHTML("beforeend",
    "<p>In-sample, for completeness: rank correlation (Spearman) " + V.spearman.toFixed(2) +
    ", median absolute percentage error " + V.medianApe.toFixed(1) + "%. In-sample numbers flatter the old model — that is why the blind tests above decide.</p>");

  // --- Scatter (log-log SVG) ---
  (function scatter() {
    const W = 760, H = 400, P = 46;
    const xs = ROWS.map((r) => Math.log(r.tvl));
    const ys = ROWS.map((r) => Math.log(r.imp));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const X = (v) => P + ((v - x0) / (x1 - x0)) * (W - 2 * P);
    const Y = (v) => H - P - ((v - y0) / (y1 - y0)) * (H - 2 * P);
    const line = "M" + X(x0) + " " + Y(V.intercept + V.slope * (x0 - V.center)) + " L" + X(x1) + " " + Y(V.intercept + V.slope * (x1 - V.center));
    const floorX = X(Math.log(D.floor));
    const dots = ROWS.map((r) => '<circle cx="' + X(Math.log(r.tvl)).toFixed(1) + '" cy="' + Y(Math.log(r.imp)).toFixed(1) +
      '" r="' + (r.wl ? 4 : 2.5) + '" fill="' + (r.wl ? "#2dd4bf" : "#5b7bb4") + '" opacity="0.8"><title>' + esc(r.name) + " " + fmtUsd(r.imp) + "</title></circle>").join("");
    $("scatter").innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Scatter of TVL against implied value">' +
      '<line x1="' + floorX + '" y1="' + (H - P) + '" x2="' + floorX + '" y2="' + P + '" stroke="#fbbf24" stroke-dasharray="4 4"/>' +
      '<text x="' + (floorX + 4) + '" y="' + (P + 12) + '" fill="#fbbf24" font-size="11">$50M floor</text>' +
      '<path d="' + line + '" stroke="#2dd4bf" stroke-width="2" fill="none"/>' +
      dots +
      '<text x="' + P + '" y="' + (H - 12) + '" fill="#8ba0c2" font-size="11">TVL (log scale) →</text>' +
      '<text x="12" y="' + (P + 4) + '" fill="#8ba0c2" font-size="11">Implied value (log scale)</text></svg>';
  })();

  // --- Sandbox ---
  function sandbox() {
    const slope = parseFloat($("slope").value);
    const centre = parseFloat($("centre").value);
    $("slope-v").textContent = slope.toFixed(2);
    $("centre-v").textContent = centre.toFixed(1);
    const top = ROWS[0];
    const alt = impliedAt(top.tvl, slope, centre);
    let moved = 0;
    const altImp = ROWS.map((r) => impliedAt(r.tvl, slope, centre));
    const order = ROWS.map((r, i) => i).sort((a, b) => altImp[b] - altImp[a] || b - a);
    order.forEach((orig, pos) => { if (orig !== pos) moved++; });
    $("sandbox-out").innerHTML = "Top of the board, " + esc(top.name) + ": board <b>" + fmtUsd(top.imp) + "</b> → sandbox <b>" + fmtUsd(alt) +
      "</b>. Rows that would change rank: <b>" + moved + "</b> of " + ROWS.length + ". The submitted board is unchanged.";
  }
  $("slope").addEventListener("input", sandbox);
  $("centre").addEventListener("input", sandbox);

  // Deep links: #p=<slug> opens a detail view, #category=<name> filters.
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("category")) { $("cat").value = hash.get("category"); }
  if (hash.get("p")) { render(); openDetail(hash.get("p")); }

  $("asof").textContent = D.asOf;
  sandbox();
  render();
}
