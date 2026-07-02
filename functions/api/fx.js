/* GET /api/fx?from=EUR&to=USD */
import { fx, handle } from "./_lib.mjs";
export const onRequest = (ctx) => handle(ctx, (q) => fx(q.from, q.to), 120);
