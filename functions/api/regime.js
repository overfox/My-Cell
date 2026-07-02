/* GET /api/regime?symbol=AAPL&class=equity&range=1y  (2-state Gaussian HMM) */
import { regime, handle } from "./_lib.mjs";
export const onRequest = (ctx) => handle(ctx, (q) => {
  if (!q.symbol) throw Object.assign(new Error("symbol required"), { status: 400 });
  return regime(q.symbol, q.class || "equity", q.range || "1y");
}, 3600);
