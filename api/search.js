/* GET /api/search?q=apple  ->  [{symbol,name,exchange,type}] */
const core = require("./_core");
module.exports = core.handler(async (q) => {
  if (!q.q) return { results: [] };
  return { results: await core.yahooSearch(q.q) };
}, 300);
