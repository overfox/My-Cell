# Helm data proxy — Cloudflare Pages Functions

Edge functions that front market-data providers **server-side**, so the Helm
PWA can price equities/ETFs/FX without browser CORS limits. Free/keyless by
default; paid real-time providers drop in via environment variables.

## Endpoints

| Route | Params | Returns |
|-------|--------|---------|
| `GET /api/quote` | `symbol`, `class` (equity·etf·crypto·option·forex·bond), `ccy` | `{symbol, price, ccy, src, asOf}` |
| `GET /api/history` | `symbol`, `class`, `range` (default `6mo`), `interval` (`1d`) | `{symbol, closes:[…]}` |
| `GET /api/fx` | `from`, `to` | `{from, to, rate, src}` |
| `GET /api/search` | `q` | `{results:[{symbol,name,exchange,type}]}` |
| `GET /api/macro` | — | `{regime, score, indicators}` — needs `FRED_API_KEY` |
| `GET /api/sentiment` | `symbol` | `{symbol, score, label, headlines}` — keyless |
| `GET /api/regime` | `symbol`, `class`, `range` | `{label, prob, states, trendAnn, persistenceDays}` — 2-state Gaussian HMM, keyless |

Routing (`_lib.mjs`): crypto → CoinGecko; equities/ETF/FX/bond → Yahoo Finance;
FX falls back to exchangerate.host. Responses carry short `s-maxage` cache
headers so Cloudflare's edge caches quotes briefly (near-real-time without
hammering upstreams). `_lib.mjs` is `_`-prefixed so Pages does not treat it as
a route — the route files import from it.

## Deploy (Cloudflare Pages)

**Option A — Git integration (recommended, auto-deploy on push):**
1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git →
   pick this repo and branch.
2. Framework preset: **None**. Build command: **(empty)**. Build output
   directory: **`/`** (repo root). Functions in `functions/` are auto-detected.
3. Deploy. The PWA is served at `/helm/`; the proxy at `/api/*` on the same
   origin, so no CORS config is needed.

**Option B — Wrangler CLI:**
```bash
npm i -g wrangler
wrangler pages deploy .        # uses wrangler.toml (pages_build_output_dir = ".")
```

## Environment variables (Pages → Settings → Variables, or `wrangler` secrets)

| Var | Effect |
|-----|--------|
| `FRED_API_KEY` | Enables `/api/macro` — free key from fred.stlouisfed.org |
| `FINNHUB_API_KEY` | Real-time equity/ETF quotes + provider news-sentiment |
| `ALLOWED_ORIGIN` | Restrict CORS (default `*`) — set to your PWA origin if hosting the PWA elsewhere |

Without `FRED_API_KEY` the macro card shows setup guidance; sentiment works
keyless (Yahoo headlines + finance lexicon) and upgrades to provider sentiment
when `FINNHUB_API_KEY` is set.

## Point the PWA at a separately-hosted proxy

If the PWA is hosted elsewhere, open **Settings → Data proxy URL** in Helm and
set it to `https://<your-pages-project>.pages.dev/api`.

## Local dev

```bash
npx wrangler pages dev .        # serves static + functions at http://localhost:8788
```
