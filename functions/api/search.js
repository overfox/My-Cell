/* GET /api/search?q=apple */
import { yahooSearch, handle } from "./_lib.mjs";
export const onRequest = (ctx) => handle(ctx, async (q) => {
  if (!q.q) return { results: [] };
  return { results: await yahooSearch(q.q) };
}, 300);
