/* GET /api/quote?symbol=AAPL&class=equity&ccy=USD  ->  current price */
const core = require("./_core");
module.exports = core.handler(async (q) => {
  if (!q.symbol) throw Object.assign(new Error("symbol required"), { status: 400 });
  return core.quote(q.symbol, q.class || "equity", q.ccy);
}, 20); // edge-cache 20s -> near-real-time without hammering upstream
