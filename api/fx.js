/* GET /api/fx?from=EUR&to=USD  ->  {from,to,rate} */
const core = require("./_core");
module.exports = core.handler(async (q) => {
  return core.fx(q.from, q.to);
}, 120); // 2 min cache
