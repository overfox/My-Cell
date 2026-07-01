/* GET /api/regime?symbol=AAPL&class=equity  ->  2-state Gaussian HMM regime
   {state, prob, label, states:[{meanAnn,volAnn,label}], persistenceDays} */
const core = require("./_core");
module.exports = core.handler(async (q) => {
  if (!q.symbol) throw Object.assign(new Error("symbol required"), { status: 400 });
  return core.regime(q.symbol, q.class || "equity", q.range || "1y");
}, 3600); // hourly cache
