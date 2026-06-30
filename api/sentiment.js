/* GET /api/sentiment?symbol=AAPL  ->  {symbol, score, label, headlines} */
const core = require("./_core");
module.exports = core.handler(async (q) => {
  if (!q.symbol) throw Object.assign(new Error("symbol required"), { status: 400 });
  return core.sentiment(q.symbol);
}, 900); // 15 min cache
