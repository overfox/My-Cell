# Helm data proxy (Phase 2a)

Serverless functions that front market-data providers **server-side**, so the
Helm PWA can price equities/ETFs/FX without browser CORS limits. Everything is
free/keyless by default; paid real-time providers drop in via env vars.

## Endpoints

| Route | Params | Returns |
|-------|--------|---------|
| `GET /api/quote` | `symbol`, `class` (equity·etf·crypto·option·forex·bond), `ccy` | `{symbol, price, ccy, src, asOf}` |
| `GET /api/history` | `symbol`, `class`, `range` (default `6mo`), `interval` (`1d`) | `{symbol, closes:[…]}` |
| `GET /api/fx` | `from`, `to` | `{from, to, rate, src}` |
| `GET /api/search` | `q` | `{results:[{symbol,name,exchange,type}]}` |
| `GET /api/macro` | — | `{regime, score, indicators}` — needs `FRED_API_KEY` |
| `GET /api/sentiment` | `symbol` | `{symbol, score, label, headlines}` — keyless |

Provider routing (in `_core.js`): crypto → CoinGecko; equities/ETF/FX/bond →
Yahoo Finance; FX falls back to exchangerate.host. Responses carry short
`s-maxage` edge-cache headers for near-real-time without hammering upstreams.

## Deploy (Vercel — recommended)

The PWA calls `/api/*` on its own origin, so host the static site and these
functions together:

```bash
npm i -g vercel
vercel        # from the repo root; deploys / (static) + /api (functions)
```

`vercel.json` redirects `/` → `/helm/` and sets the function runtime. No build
step, no dependencies.

## Optional paid real-time (paid-ready seam)

Set env vars in the Vercel dashboard; the core prefers them and falls back to
Yahoo automatically:

| Env var | Effect |
|---------|--------|
| `FINNHUB_API_KEY` | Real-time US equity/ETF quotes + provider news-sentiment via Finnhub |
| `FRED_API_KEY` | Macro engine (`/api/macro`) — free key from fred.stlouisfed.org |
| `ALLOWED_ORIGIN` | Restrict CORS (default `*`) — set to your PWA origin |

Without `FRED_API_KEY` the macro card shows setup guidance; sentiment works
keyless (Yahoo headlines + finance lexicon) and upgrades to provider sentiment
when `FINNHUB_API_KEY` is set.

Add a Polygon/Alpaca provider the same way: write a `…Quote()` in `_core.js`,
gate it on its key in `quote()`. No front-end change needed.

## Point the PWA at a separately-hosted proxy

If the PWA lives elsewhere (e.g. GitHub Pages) and the proxy on Vercel, open
**Settings → Data proxy URL** in Helm and set it to
`https://your-app.vercel.app/api`.

## Other platforms

The handlers are thin wrappers over `_core.js` (pure CommonJS, global `fetch`).
For **Cloudflare Pages Functions**, put files under `functions/api/` and adapt
the `(request)` signature; for **Netlify**, wrap `_core` calls in a
`netlify/functions/*` handler. The routing/normalization logic is unchanged.
