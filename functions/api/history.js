/* GET /api/history?symbol=AAPL&class=equity&range=6mo&interval=1d */
import { history, handle } from "./_lib.mjs";
export const onRequest = (ctx) => handle(ctx, async (q) => {
  if (!q.symbol) throw Object.assign(new Error("symbol required"), { status: 400 });
  return { symbol: q.symbol, closes: await history(q.symbol, q.class || "equity", q.range, q.interval) };
}, 300);
