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

module.exports = { quote, history, fx, yahooSearch, handler, send, cors };
