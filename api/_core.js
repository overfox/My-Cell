/* Helm data proxy — portable core (CommonJS, no deps).
   Runs server-side so browser CORS limits on equity/FX feeds disappear.
   Provider routing is env-driven and "paid-ready": set POLYGON_API_KEY or
   FINNHUB_API_KEY to prefer real-time equity quotes; otherwise free Yahoo /
   CoinGecko are used. The Vercel handlers in this folder are thin wrappers
   around these functions, so the same core drops into Cloudflare Workers,
   Netlify or a tiny Express app unchanged. */

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
async function yahooSearch(q) {
  const j = await getJSON(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`);
  return (j.quotes || []).filter((x) => x.symbol).map((x) => ({
    symbol: x.symbol, name: x.shortname || x.longname || "", exchange: x.exchDisp || x.exchange || "",
    type: (x.quoteType || "").toLowerCase() }));
}

/* ---- Finnhub (optional, paid-ready real-time equities) ----------------- */
async function finnhubQuote(symbol) {
  const k = process.env.FINNHUB_API_KEY;
  if (!k) throw httpErr(501, "finnhub not configured");
  const j = await getJSON(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${k}`);
  if (j.c == null || j.c === 0) throw httpErr(404, `finnhub no price for ${symbol}`);
  return { symbol, price: j.c, ccy: "USD", prevClose: j.pc, asOf: Date.now(), src: "finnhub" };
}

/* ---- public, provider-routed API --------------------------------------- */
async function quote(symbol, assetClass, ccy) {
  if (assetClass === "crypto") return coingeckoQuote(symbol, ccy);
  // prefer a configured paid real-time provider, fall back to free Yahoo
  if (process.env.FINNHUB_API_KEY && (assetClass === "equity" || assetClass === "etf")) {
    try { return await finnhubQuote(symbol); } catch (e) { /* fall through to Yahoo */ }
  }
  return yahooQuote(symbol);
}
async function history(symbol, assetClass, range, interval) {
  if (assetClass === "crypto") {
    const days = { "1mo":30, "3mo":90, "6mo":120, "1y":365, "2y":730 }[range] || 120;
    return coingeckoHistory(symbol, "usd", days);
  }
  return yahooHistory(symbol, range, interval);
}
async function fx(from, to) {
  from = (from || "USD").toUpperCase(); to = (to || "USD").toUpperCase();
  if (from === to) return { from, to, rate: 1, asOf: Date.now(), src: "identity" };
  try {
    const q = await yahooQuote(`${from}${to}=X`);
    return { from, to, rate: q.price, asOf: Date.now(), src: "yahoo" };
  } catch (e) {
    // free keyless fallback
    const j = await getJSON(`https://api.exchangerate.host/latest?base=${from}&symbols=${to}`);
    const rate = j && j.rates && j.rates[to];
    if (rate == null) throw httpErr(502, `no fx ${from}->${to}`);
    return { from, to, rate, asOf: Date.now(), src: "exchangerate.host" };
  }
}

/* ---- Macro engine (FRED, free with key) -------------------------------- */
const FRED = "https://api.stlouisfed.org/fred/series/observations";
async function fredSeries(id, limit) {
  const k = process.env.FRED_API_KEY;
  if (!k) throw httpErr(501, "FRED_API_KEY not configured");
  const j = await getJSON(`${FRED}?series_id=${id}&api_key=${k}&file_type=json&sort_order=desc&limit=${limit || 13}`);
  return (j.observations || []).map((o) => ({ date: o.date, value: o.value === "." ? null : parseFloat(o.value) })).filter((o) => o.value != null);
}
async function macro() {
  // latest-first series: 10y-2y spread, fed funds, CPI level, unemployment
  const [curve, funds, cpi, unrate] = await Promise.all([
    fredSeries("T10Y2Y", 5), fredSeries("FEDFUNDS", 13), fredSeries("CPIAUCSL", 14), fredSeries("UNRATE", 13),
  ]);
  const latest = (a) => (a[0] ? a[0].value : null);
  const yoy = (a) => (a.length >= 13 && a[0] && a[12] ? (a[0].value / a[12].value - 1) * 100 : null);
  const trend = (a, n) => (a.length > n ? a[0].value - a[n].value : null); // latest minus n-periods-ago
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
async function finnhubSentiment(symbol) {
  const k = process.env.FINNHUB_API_KEY;
  if (!k) throw httpErr(501, "finnhub not configured");
  const j = await getJSON(`https://finnhub.io/api/v1/news-sentiment?symbol=${encodeURIComponent(symbol)}&token=${k}`);
  const b = j.sentiment && j.sentiment.bullishPercent;
  if (b == null) throw httpErr(404, `no finnhub sentiment for ${symbol}`);
  const score = (b - 0.5) * 2;
  return { symbol, score, label: score > 0.2 ? "bullish" : score < -0.2 ? "bearish" : "neutral",
           n: j.buzz ? j.buzz.articlesInLastWeek : null, scored: null, headlines: [], asOf: Date.now(), src: "finnhub" };
}
async function sentiment(symbol) {
  if (process.env.FINNHUB_API_KEY) { try { return await finnhubSentiment(symbol); } catch (e) { /* fall back to lexicon */ } }
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

/* ---- handler helpers (shared by every Vercel function) ----------------- */
function cors(req, res) {
  const allow = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function send(res, status, body, cacheSecs) {
  if (cacheSecs) res.setHeader("Cache-Control", `public, s-maxage=${cacheSecs}, stale-while-revalidate=${cacheSecs * 3}`);
  res.setHeader("Content-Type", "application/json");
  res.statusCode = status;
  res.end(JSON.stringify(body));
}
/* Wrap a (query)->data function into a Vercel-style handler. */
function handler(fn, cacheSecs) {
  return async (req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
    try {
      const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
      const data = await fn(q);
      send(res, 200, data, cacheSecs);
    } catch (e) {
      send(res, e.status || 500, { error: e.message || "proxy error" });
    }
  };
}

module.exports = { quote, history, fx, yahooSearch, macro, sentiment, handler, send, cors };
