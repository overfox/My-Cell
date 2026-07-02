/* GET /api/macro  (needs FRED_API_KEY) */
import { macro, handle } from "./_lib.mjs";
export const onRequest = (ctx) => handle(ctx, (q, env) => macro(env), 3600);
