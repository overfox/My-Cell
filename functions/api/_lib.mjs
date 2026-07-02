/* Helm data proxy — shared core for Cloudflare Pages Functions (ESM, no deps).
   Runs at the edge so browser CORS limits on equity/FX feeds disappear.
   Secrets arrive via `env` (context.env on Cloudflare), never process.env, so
   the same code runs at the edge and under Node for tests. Provider routing is
   "paid-ready": set FINNHUB_API_KEY to prefer real-time equity quotes; else
   free Yahoo / CoinGecko are used. */

const UA = { headers: { "User-Agent": "Mozilla/5.0 (compatible; HelmCockpit/1.0)" } };

function httpErr(status, msg) { const e = new Error(msg); e.status = status; return e; }
async function getJSON(url, opts) {
  const r = await fetch(url, Object.assign({}, UA, opts));
  if (!r.ok) throw httpErr(r.status, `upstream ${r.status} for ${new URL(url).host}`);
  return r.json();
}

/* ---- CoinGecko (free, crypto) ------------------------------------------ */
const CG_MAP = { btc:"bitcoin", eth:"ethereum", sol:"solana", ada:"cardano", xrp:"ripple",
  doge:"dogecoin", bnb:"binancecoin", usdt:"tether", usdc:"usd-coin", matic:"matic-network",
  dot:"polkadot", ltc:"litecoin", link:"chainlink", avax:"avalanche-2", trx:"tron", bch:"bitcoin-cash" };
const cgId = (s) => CG_MAP[s.toLowerCase()] || s.toLowerCase();

async function coingeckoQuote(symbol, ccy) {
  const id = cgId(symbol), c = (ccy || "usd").toLowerCase();
  const j = await getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=${c}`);
  const p = j[id] && j[id][c];
  if (p == null) throw httpErr(404, `no crypto price for ${symbol}`);
  return { symbol, price: p, ccy: (ccy || "USD").toUpperCase(), asOf: Date.now(), src: "coingecko" };
}
async function coingeckoHistory(symbol, ccy, days) {
  const id = cgId(symbol), c = (ccy || "usd").toLowerCase();
  const j = await getJSON(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=${c}&days=${days || 120}&interval=daily`);
  return (j.prices || []).map((p) => p[1]);
}

/* ---- Yahoo Finance (free, equities/ETF/FX/index/bond) ------------------ */
async function yahooQuote(symbol) {
  const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`);
  const m = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
  if (!m || m.regularMarketPrice == null) throw httpErr(404, `no price for ${symbol}`);
  return { symbol, price: m.regularMarketPrice, ccy: m.currency || "USD",
           exchange: m.exchangeName, prevClose: m.chartPreviousClose, asOf: Date.now(), src: "yahoo" };
}
async function yahooHistory(symbol, range, interval) {
  const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range || "6mo"}&interval=${interval || "1d"}`);
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw httpErr(404, `no history for ${symbol}`);
  const closes = res.indicators.quote[0].close || [];
  return closes.filter((x) => x != null);
}
export async function yahooSearch(q) {
  const j = await getJSON(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`);
  return (j.quotes || []).filter((x) => x.symbol).map((x) => ({
    symbol: x.symbol, name: x.shortname || x.longname || "", exchange: x.exchDisp || x.exchange || "",
    type: (x.quoteType || "").toLowerCase() }));
}

/* ---- Finnhub (optional, paid-ready real-time equities) ----------------- */
async function finnhubQuote(symbol, env) {
  const k = env.FINNHUB_API_KEY;
  if (!k) throw httpErr(501, "finnhub not configured");
  const j = await getJSON(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${k}`);
  if (j.c == null || j.c === 0) throw httpErr(404, `finnhub no price for ${symbol}`);
  return { symbol, price: j.c, ccy: "USD", prevClose: j.pc, asOf: Date.now(), src: "finnhub" };
}

/* ---- public, provider-routed API --------------------------------------- */
export async function quote(symbol, assetClass, ccy, env = {}) {
  if (assetClass === "crypto") return coingeckoQuote(symbol, ccy);
  if (env.FINNHUB_API_KEY && (assetClass === "equity" || assetClass === "etf")) {
    try { return await finnhubQuote(symbol, env); } catch (e) { /* fall through to Yahoo */ }
  }
  return yahooQuote(symbol);
}
export async function history(symbol, assetClass, range, interval) {
  if (assetClass === "crypto") {
    const days = { "1mo":30, "3mo":90, "6mo":120, "1y":365, "2y":730 }[range] || 120;
    return coingeckoHistory(symbol, "usd", days);
  }
  return yahooHistory(symbol, range, interval);
}
export async function fx(from, to) {
  from = (from || "USD").toUpperCase(); to = (to || "USD").toUpperCase();
  if (from === to) return { from, to, rate: 1, asOf: Date.now(), src: "identity" };
  try {
    const q = await yahooQuote(`${from}${to}=X`);
    return { from, to, rate: q.price, asOf: Date.now(), src: "yahoo" };
  } catch (e) {
    const j = await getJSON(`https://api.exchangerate.host/latest?base=${from}&symbols=${to}`);
    const rate = j && j.rates && j.rates[to];
    if (rate == null) throw httpErr(502, `no fx ${from}->${to}`);
    return { from, to, rate, asOf: Date.now(), src: "exchangerate.host" };
  }
}

/* ---- Macro engine (FRED, free with key) -------------------------------- */
const FRED = "https://api.stlouisfed.org/fred/series/observations";
async function fredSeries(id, limit, env) {
  const k = env.FRED_API_KEY;
  if (!k) throw httpErr(501, "FRED_API_KEY not configured");
  const j = await getJSON(`${FRED}?series_id=${id}&api_key=${k}&file_type=json&sort_order=desc&limit=${limit || 13}`);
  return (j.observations || []).map((o) => ({ date: o.date, value: o.value === "." ? null : parseFloat(o.value) })).filter((o) => o.value != null);
}
export async function macro(env = {}) {
  const [curve, funds, cpi, unrate] = await Promise.all([
    fredSeries("T10Y2Y", 5, env), fredSeries("FEDFUNDS", 13, env), fredSeries("CPIAUCSL", 14, env), fredSeries("UNRATE", 13, env),
  ]);
  const latest = (a) => (a[0] ? a[0].value : null);
  const yoy = (a) => (a.length >= 13 && a[0] && a[12] ? (a[0].value / a[12].value - 1) * 100 : null);
  const trend = (a, n) => (a.length > n ? a[0].value - a[n].value : null);
  const ind = {
    yieldCurve: latest(curve), fedFunds: latest(funds), fedFundsChg6m: trend(funds, 6),
    inflationYoY: yoy(cpi), unemployment: latest(unrate), unemploymentChg6m: trend(unrate, 6),
  };
  let s = 0;
  if (ind.yieldCurve != null) s += ind.yieldCurve < 0 ? -1 : ind.yieldCurve < 0.5 ? -0.3 : 0.3;
  if (ind.fedFundsChg6m != null) s += ind.fedFundsChg6m > 0.25 ? -0.6 : ind.fedFundsChg6m < -0.25 ? 0.6 : 0;
  if (ind.inflationYoY != null) s += ind.inflationYoY > 4 ? -0.6 : ind.inflationYoY > 3 ? -0.3 : ind.inflationYoY < 2 ? 0.2 : 0;
  if (ind.unemploymentChg6m != null) s += ind.unemploymentChg6m > 0.3 ? -0.6 : ind.unemploymentChg6m < -0.1 ? 0.4 : 0;
  const score = Math.max(-1, Math.min(1, s / 2));
  const inverted = ind.yieldCurve != null && ind.yieldCurve < 0;
  const hot = ind.inflationYoY != null && ind.inflationYoY > 4;
  let regime;
  if (score > 0.3) regime = "expansion";
  else if (score < -0.4) regime = inverted ? "contraction" : "slowdown";
  else regime = hot ? "stagflation-risk" : "late-cycle";
  return { regime, score, indicators: ind, asOf: Date.now(), src: "fred" };
}

/* ---- Sentiment engine (keyless: news headlines + finance lexicon) ------ */
const SENT_POS = "beat beats surge surges soar soars rally record growth upgrade upgraded outperform strong gain gains jumps jump rises rise boost bullish profit profits wins win breakthrough raises raise tops top expands optimistic recovery rebound buyback dividend".split(" ");
const SENT_NEG = "miss misses plunge plummet fall falls drop drops slump downgrade downgraded underperform weak loss losses cuts cut warns warning bearish lawsuit probe investigation recall decline declines slows slowdown fears fear crash sinks sink tumble tumbles layoffs bankruptcy default halts halt".split(" ");
function scoreHeadline(t) {
  const words = String(t).toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/);
  let s = 0, hits = 0;
  for (const w of words) { if (SENT_POS.includes(w)) { s++; hits++; } else if (SENT_NEG.includes(w)) { s--; hits++; } }
  return { sign: Math.sign(s), hits };
}
async function yahooNews(symbol) {
  const j = await getJSON(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=12`);
  return (j.news || []).map((n) => ({ title: n.title, publisher: n.publisher, link: n.link, ts: n.providerPublishTime }));
}
async function finnhubSentiment(symbol, env) {
  const k = env.FINNHUB_API_KEY;
  if (!k) throw httpErr(501, "finnhub not configured");
  const j = await getJSON(`https://finnhub.io/api/v1/news-sentiment?symbol=${encodeURIComponent(symbol)}&token=${k}`);
  const b = j.sentiment && j.sentiment.bullishPercent;
  if (b == null) throw httpErr(404, `no finnhub sentiment for ${symbol}`);
  const score = (b - 0.5) * 2;
  return { symbol, score, label: score > 0.2 ? "bullish" : score < -0.2 ? "bearish" : "neutral",
           n: j.buzz ? j.buzz.articlesInLastWeek : null, scored: null, headlines: [], asOf: Date.now(), src: "finnhub" };
}
export async function sentiment(symbol, env = {}) {
  if (env.FINNHUB_API_KEY) { try { return await finnhubSentiment(symbol, env); } catch (e) { /* fall back to lexicon */ } }
  const news = await yahooNews(symbol);
  let total = 0, scored = 0;
  const headlines = news.map((n) => {
    const r = scoreHeadline(n.title);
    if (r.hits > 0) { total += r.sign; scored++; }
    return { title: n.title, publisher: n.publisher, sign: r.sign };
  });
  const score = scored ? total / scored : 0;
  return { symbol, score, label: score > 0.2 ? "bullish" : score < -0.2 ? "bearish" : "neutral",
           n: news.length, scored, headlines: headlines.slice(0, 6), asOf: Date.now(), src: "yahoo+lexicon" };
}

/* ---- Regime engine: 2-state Gaussian HMM on log returns (pure) --------- */
export function hmmRegime(closes) {
  const px = (closes || []).filter((x) => x > 0);
  if (px.length < 40) return { error: "insufficient history (need 40+ closes)" };
  const r = [];
  for (let i = 1; i < px.length; i++) r.push(Math.log(px[i] / px[i - 1]));
  const T = r.length, K = 2;
  const mean = r.reduce((a, b) => a + b, 0) / T;
  const varAll = r.reduce((a, b) => a + (b - mean) ** 2, 0) / T || 1e-6;
  let mu = [mean + Math.sqrt(varAll) * 0.3, mean - Math.sqrt(varAll) * 0.3];
  let vr = [varAll * 0.6, varAll * 1.8];
  let A = [[0.9, 0.1], [0.15, 0.85]];
  let pi = [0.6, 0.4];
  const g = (x, m, v) => Math.exp(-((x - m) ** 2) / (2 * v)) / Math.sqrt(2 * Math.PI * v);
  let gamma = [];
  for (let it = 0; it < 40; it++) {
    const alpha = Array.from({ length: T }, () => [0, 0]), c = new Array(T).fill(0);
    for (let k = 0; k < K; k++) alpha[0][k] = pi[k] * g(r[0], mu[k], vr[k]);
    c[0] = alpha[0][0] + alpha[0][1] || 1e-300; alpha[0][0] /= c[0]; alpha[0][1] /= c[0];
    for (let t = 1; t < T; t++) {
      for (let k = 0; k < K; k++) alpha[t][k] = (alpha[t-1][0]*A[0][k] + alpha[t-1][1]*A[1][k]) * g(r[t], mu[k], vr[k]);
      c[t] = alpha[t][0] + alpha[t][1] || 1e-300; alpha[t][0] /= c[t]; alpha[t][1] /= c[t];
    }
    const beta = Array.from({ length: T }, () => [0, 0]); beta[T-1] = [1, 1];
    for (let t = T-2; t >= 0; t--) for (let k = 0; k < K; k++)
      beta[t][k] = (A[k][0]*g(r[t+1],mu[0],vr[0])*beta[t+1][0] + A[k][1]*g(r[t+1],mu[1],vr[1])*beta[t+1][1]) / c[t+1];
    gamma = Array.from({ length: T }, () => [0, 0]);
    const Asum = [[0,0],[0,0]];
    for (let t = 0; t < T; t++) { const den = alpha[t][0]*beta[t][0] + alpha[t][1]*beta[t][1] || 1e-300;
      for (let k = 0; k < K; k++) gamma[t][k] = alpha[t][k]*beta[t][k] / den; }
    for (let t = 0; t < T-1; t++) { const xi = [[0,0],[0,0]]; let den = 0;
      for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) { xi[i][j] = alpha[t][i]*A[i][j]*g(r[t+1],mu[j],vr[j])*beta[t+1][j]/c[t+1]; den += xi[i][j]; }
      den = den || 1e-300;
      for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) Asum[i][j] += xi[i][j] / den; }
    pi = [gamma[0][0], gamma[0][1]];
    for (let i = 0; i < K; i++) { const rd = Asum[i][0] + Asum[i][1] || 1e-300; A[i][0] = Asum[i][0]/rd; A[i][1] = Asum[i][1]/rd; }
    for (let k = 0; k < K; k++) { let gk = 0, mk = 0; for (let t = 0; t < T; t++) { gk += gamma[t][k]; mk += gamma[t][k]*r[t]; }
      gk = gk || 1e-300; mu[k] = mk/gk; let vk = 0; for (let t = 0; t < T; t++) vk += gamma[t][k]*(r[t]-mu[k])**2; vr[k] = Math.max(vk/gk, 1e-8); }
  }
  const W = Math.min(7, T);
  let g0 = 0, g1 = 0; for (let t = T - W; t < T; t++) { g0 += gamma[t][0]; g1 += gamma[t][1]; }
  const cur = g0 >= g1 ? 0 : 1;
  const conf = (cur === 0 ? g0 : g1) / W;
  const stat = (k) => ({ meanAnn: mu[k]*252*100, volAnn: Math.sqrt(vr[k]*252)*100 });
  const states = [stat(0), stat(1)].map((s) => ({ ...s, label: s.volAnn > 60 ? "crisis" : s.meanAnn > 10 ? "bull" : s.meanAnn < -10 ? "bear" : "chop" }));
  const wT = Math.min(60, T); let tm = 0; for (let t = T - wT; t < T; t++) tm += r[t];
  const trendAnn = (tm / wT) * 252 * 100;
  const curVol = states[cur].volAnn;
  const volatileState = curVol > states[1 - cur].volAnn * 1.5 && curVol > 25;
  let lbl;
  if (curVol > 60) lbl = "crisis";
  else if (volatileState) lbl = trendAnn < -8 ? "bear" : "chop";
  else lbl = trendAnn > 8 ? "bull" : trendAnn < -8 ? "bear" : "chop";
  const a = Math.min(A[cur][cur], 0.999);
  return { state: cur, prob: conf, label: lbl, states, trendAnn,
           persistenceDays: 1 / (1 - a), transition: A, n: T, src: "hmm" };
}
export async function regime(symbol, assetClass, range) {
  const closes = await history(symbol, assetClass, range || "1y", "1d");
  return Object.assign({ symbol }, hmmRegime(closes));
}

/* ---- Cloudflare Pages Functions handler helper ------------------------- */
function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
export function json(data, { status = 200, cacheSecs = 0, env = {} } = {}) {
  const h = Object.assign({ "Content-Type": "application/json" }, corsHeaders(env));
  if (cacheSecs) h["Cache-Control"] = `public, s-maxage=${cacheSecs}, stale-while-revalidate=${cacheSecs * 3}`;
  return new Response(JSON.stringify(data), { status, headers: h });
}
/* Wrap a (query, env) -> data function into a Pages Functions onRequest. */
export function handle(context, fn, cacheSecs) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(env) });
  const q = Object.fromEntries(new URL(request.url).searchParams);
  return Promise.resolve().then(() => fn(q, env))
    .then((data) => json(data, { cacheSecs, env }))
    .catch((e) => json({ error: e.message || "proxy error" }, { status: e.status || 500, env }));
}
