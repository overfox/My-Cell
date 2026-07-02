/* GET /api/quote?symbol=AAPL&class=equity&ccy=USD */
import { quote, handle } from "./_lib.mjs";
export const onRequest = (ctx) => handle(ctx, (q, env) => {
  if (!q.symbol) throw Object.assign(new Error("symbol required"), { status: 400 });
  return quote(q.symbol, q.class || "equity", q.ccy, env);
}, 20);
