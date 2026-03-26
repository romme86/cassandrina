# VPN Access Plan for Cassandrina, RTL, and Bitcoin Core with Nginx

## Summary
Use **Tailscale Serve + Nginx** as the access pattern on the Pi.

- Keep local services bound to localhost or internal Docker networking.
- Add an **Nginx container** as the single local reverse proxy.
- Expose Nginx to the tailnet with **Tailscale Serve**.
- Publish the preferred URLs as:
  - `https://raspberrypi.taile12a8d.ts.net/cassandrina`
  - `https://raspberrypi.taile12a8d.ts.net/rtl` if RTL works cleanly under a subpath

Bitcoin Core itself will not expose raw RPC or P2P to the tailnet in v1. "Reachable from the VPN" means operational access via Tailscale SSH and node management through RTL/local services.

## Key Changes
### Nginx as the reverse proxy
- Add an `nginx` service to the Pi deployment as a Docker container in the same Compose stack. [implemented]
- Bind Nginx only to localhost on the Pi, for example `127.0.0.1:<proxy_port>`. [implemented]
- Use Nginx as the single internal HTTP entrypoint for Tailscale Serve. [implemented]
- Configure Nginx to:
  - proxy `/cassandrina` to the Cassandrina webapp [implemented]
  - proxy `/rtl` to the RTL service [implemented]
  - strip or preserve prefixes intentionally per upstream behavior [implemented]
  - forward standard proxy headers (`Host`, `X-Forwarded-*`) [implemented]
  - support websocket upgrades for admin UIs [implemented]

### Cassandrina exposure
- Keep the existing webapp container private and localhost-only. [implemented]
- Add explicit base-path support in Cassandrina for `/cassandrina`. [implemented]
- Update app URL/auth/runtime configuration so all generated URLs, assets, and callbacks work under `/cassandrina`. [implemented]
- Route traffic through Nginx instead of exposing port `3000` directly to the tailnet. [implemented]

### RTL installation and exposure
- Add RTL as a new Pi-side service, preferably a Docker container managed alongside the existing Compose stack. [implemented]
- Keep RTL private to the Pi/local Docker network. [implemented]
- Proxy RTL through Nginx at `/rtl`. [implemented]
- Mount LND TLS cert and macaroons into RTL using least-privilege access needed for management. [implemented]
- If RTL does not validate cleanly under `/rtl`, keep Nginx for Cassandrina and move RTL to its own dedicated Tailscale Serve endpoint as the approved fallback.

### Tailscale integration
- Use `tailscale serve` to publish the Nginx endpoint to the tailnet. [implemented]
- Use the Pi's MagicDNS hostname `raspberrypi.taile12a8d.ts.net`. [implemented]
- Do not bind Cassandrina, RTL, Bitcoin Core RPC, or LND REST directly to the tailnet IP. [implemented]
- Keep local ports private; Tailscale Serve is the only VPN-facing access layer. [implemented]

### Bitcoin Core and LND scope
- Keep Bitcoin Core RPC on `127.0.0.1:8332` only.
- Keep Bitcoin Core P2P private to its intended node operation; do not expose `8333` to the tailnet for admin use.
- Keep LND private for now; RTL is the management interface. [implemented]
- Continue temporary clearnet Bitcoin sync until the chain is much closer to tip, then restore Tor settings later if desired.

## Interfaces and Config
- Docker Compose:
  - add `nginx` [implemented]
  - add `rtl` [implemented]
  - wire both into the existing stack without widening public port exposure [implemented]
- Nginx:
  - add one checked-in config file with upstreams and path routing for `/cassandrina` and `/rtl` [implemented]
- Cassandrina:
  - add base-path-aware routing/config for `/cassandrina` [implemented]
  - update auth/public URL handling accordingly [implemented]
- Tailscale:
  - add persistent Serve configuration targeting the localhost-bound Nginx port [implemented]
- RTL:
  - configure against local LND artifacts and local service endpoints only [implemented]

## Test Plan
- Local checks:
  - `curl http://127.0.0.1:3000` still returns `200`
  - Nginx responds locally on its localhost-bound port
  - Nginx correctly proxies `/cassandrina` and `/rtl`
- Cassandrina path checks:
  - app loads at `/cassandrina`
  - assets, navigation, auth, and callbacks do not escape to `/`
- RTL checks:
  - RTL starts and can reach local LND once LND is healthy
  - if `/rtl` is unstable, validate the fallback dedicated tailnet endpoint
- Tailnet checks:
  - from another tailnet device, the Nginx-published URL is reachable over MagicDNS
  - only the Tailscale Serve endpoint is exposed; direct raw app ports remain private
- Security checks:
  - `8332`, `3000`, and RTL's internal port remain inaccessible directly from other tailnet devices
  - Bitcoin Core remains SSH/admin-managed, not RPC-exposed

## Assumptions and Defaults
- Reverse proxy choice: **Nginx**
- VPN exposure model: **Tailscale Serve**
- URL model: one shared hostname with paths
- Bitcoin Core access model: RTL/SSH only, not raw RPC exposure
- RTL fallback: allow a dedicated endpoint if `/rtl` under Nginx is not reliable
- Current environment assumptions:
  - Tailscale is installed and healthy on the Pi
  - Cassandrina webapp is running in Docker on `127.0.0.1:3000`
  - Bitcoin Core is syncing on the Pi
  - LND exists but is not yet the primary operational focus until Bitcoin Core catches up

---

# Known Issues & Improvements

## Security

1. **PIN authentication is trivially weak** — cookie now uses HMAC-signed token instead of static `"1"`. [implemented]

2. **No brute-force protection on PIN endpoint** — rate limiting added (5 attempts per 15 minutes per IP). [implemented]

3. **TLS verification disabled by default** — default flipped to verify; set `LND_TLS_SKIP_VERIFY=true` to disable. [implemented]

4. **In-process rate limiting** (`app/api/predictions/route.ts:9`): `rateLimitMap` is a `Map` in memory — replaced with Redis-based rate limiting using `INCR` + `EXPIRE`. [implemented]

5. **Admin secret comparison is not timing-safe** — now uses `crypto.timingSafeEqual`. [implemented]

6. **`RETURNING *` in queries** — narrowed to explicit column lists. [implemented]

## Structure

7. **Race condition on "one prediction per user per round"** — now uses `pg_advisory_xact_lock` + duplicate check inside a transaction. [implemented]

8. **Race condition in `mark_invoice_paid`** — now uses `pg_advisory_xact_lock` to prevent concurrent payment processing. [implemented]

9. **Each repository method acquires its own connection** — added `connection()` context manager with thread-local storage; settlement now shares a single connection per round. [implemented]

10. **DDL at request time** — moved `dropLegacyQuestionDateConstraint` to `init.sql`. [implemented]

11. **Config update is not atomic** — wrapped in `withTransaction`. [implemented]

12. **`SimpleConnectionPool` is not thread-safe** — switched to `ThreadedConnectionPool`. [implemented]

13. **No connection pool limits configured in webapp** — configured min/max/idle/connection timeouts. [implemented]

## Trading Logic

14. **Minimum lot size inflates real exposure** — now returns 0.0 and skips the trade if pool is below minimum lot size. [implemented]

15. **Spot strategy always buys, even for "short" direction** — now calls `spot_sell()` for short direction. [implemented]

16. **No stop-loss for any strategy** — stop-loss orders now placed for all strategies (A: 2.5%, B: 4%, D: 5%, E: 3%). [implemented]

17. **Trade PnL is computed from price difference, not from actual exchange data** — now queries Binance futures income history and spot trade fills for actual PnL, with theoretical fallback. [implemented]

18. **Grid orders are only buy-side** — grid now places buy orders below midpoint and sell orders above. [implemented]

19. **No position closing at settlement** — positions are now closed on Binance at settlement time before computing PnL. [implemented]

## Performance

20. **`add_balance_entries` inserts one row at a time** — now uses a single multi-row INSERT. [implemented]

21. **`_verify_round_payments` polls LND for every unpaid invoice** — added `subscribe_invoices` streaming via LND REST with auto-reconnect background thread; polling kept as fallback. [implemented]

22. **Polymarket matching is fragile** — improved with relevance scoring (BTC + price keywords, date/month matching). [implemented]

23. **No graceful shutdown for trading-bot** — shutdown now closes Redis and database pool. [implemented]

24. **Duplicate sats calculation in scheduler** — now uses stored user congruency scores instead of recomputing. [implemented]

25. **Go module cache committed to repo** — added to `.gitignore`. [implemented]

## Missing Features

### High Priority (Operational Safety)
- Stop-loss orders — implemented per-strategy SL percentages and Binance order placement. [implemented]
- Position reconciliation with Binance — scheduled job compares DB trades against actual Binance positions 1h before settlement; discrepancies published to Redis. [implemented]
- Actual trade closing at settlement — positions closed on Binance before PnL computation. [implemented]
- Invoice expiry cleanup — scheduled job every 30 minutes deletes expired unpaid invoices and associated predictions. [implemented]
- Fund custody tracking — daily reconciliation job compares ledger totals against LND channel balance and Binance spot balance. [implemented]

### Medium Priority (Product)
- User withdrawal mechanism — `POST /api/wallet/withdraw` pays a Lightning invoice and debits user balance with advisory lock protection. [implemented]
- Historical accuracy display per user — `GET /api/users/:id` now returns hit/miss, error percentage, and stats summary. [implemented]
- Full history of predictions and orders — `GET /api/history/predictions` with round_id/user_id filters and pagination. [implemented]
- Strategy vote persistence — `strategy_votes` table, `POST/GET /api/votes`, weekly vote winner overrides confidence-based strategy. [implemented]
- Multi-round support within a day — scheduler and settlement already handle multiple rounds per day; admin override settles previous round first. [implemented]
- Mobile-responsive dashboard — sidebar collapses to hamburger menu on mobile, main content uses responsive margins. [implemented]

### Low Priority (Infrastructure)
- Health check endpoints — `/api/health` added, Docker services now use `service_healthy`. [implemented]
- Database migrations — `node-pg-migrate` installed with `migrate:up/down/create` scripts; first migration adds `strategy_votes` table. [implemented]
- Observability — structured JSON logging for trading-bot, Prometheus-compatible `/api/metrics` endpoint for webapp. [implemented]

## Configuration Changes

- **Prediction limits updated**: min_sats default changed from 100 to 1000, max_sats from 5000 to 10000. [implemented]
- Limits are configurable via the admin panel (Settings > Sats Limits). [implemented]
