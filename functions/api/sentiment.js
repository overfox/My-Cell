/* GET /api/sentiment?symbol=AAPL */
import { sentiment, handle } from "./_lib.mjs";
export const onRequest = (ctx) => handle(ctx, (q, env) => {
  if (!q.symbol) throw Object.assign(new Error("symbol required"), { status: 400 });
  return sentiment(q.symbol, env);
}, 900);
