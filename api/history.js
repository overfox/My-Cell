/* GET /api/history?symbol=AAPL&class=equity&range=6mo&interval=1d  ->  {closes:[...]} */
const core = require("./_core");
module.exports = core.handler(async (q) => {
  if (!q.symbol) throw Object.assign(new Error("symbol required"), { status: 400 });
  const closes = await core.history(q.symbol, q.class || "equity", q.range, q.interval);
  return { symbol: q.symbol, closes };
}, 300); // history changes slowly -> 5 min edge cache
