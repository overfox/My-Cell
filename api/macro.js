/* GET /api/macro  ->  {regime, score, indicators}  (needs free FRED_API_KEY) */
const core = require("./_core");
module.exports = core.handler(async () => core.macro(), 3600); // hourly cache
