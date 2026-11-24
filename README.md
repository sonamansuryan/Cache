# catalog-api

The product-catalog service behind the shop's category pages. Products (name, category, price, stock) live in MySQL and are served over a small JSON API.

## Stack

Node.js 22, Express 5, Sequelize 6 with sequelize-cli migrations, MySQL 8.4. Docker Compose runs MySQL and Redis locally.

## Run it

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run db:seed
npm start
```

The API listens on http://localhost:4000. `npm run dev` restarts on file changes. `npm run db:reset` drops, migrates and reseeds.

If port 3307 or 6379 is taken on your machine, change `DB_PORT` or `REDIS_PORT` in `.env` before `docker compose up`.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Database connectivity check |
| GET | `/api/products` | List. Query: `category`, `sort` (`newest`, `price_asc`, `price_desc`), `page` (default 1), `limit` (default 20, max 100) |
| GET | `/api/products/:id` | One product |
| PATCH | `/api/products/:id` | Update `price` and/or `stock`. JSON body |

```bash
curl 'http://localhost:4000/api/products?category=toys&sort=price_asc&page=2&limit=2'
```
```json
{
  "items": [
    {"id":14566,"name":"Deluxe Set 14566","category":"toys","price":1.23,"stock":159,"createdAt":"2026-09-24T07:44:35.000Z","updatedAt":"2026-09-24T07:44:35.000Z"},
    {"id":22625,"name":"Vintage Board 22625","category":"toys","price":1.41,"stock":170,"createdAt":"2026-05-27T07:44:35.000Z","updatedAt":"2026-05-27T07:44:35.000Z"}
  ],
  "page": 2, "limit": 2, "total": 4167
}
```

```bash
curl http://localhost:4000/api/products/123
curl -X PATCH http://localhost:4000/api/products/123 -H 'Content-Type: application/json' -d '{"price": 19.99}'
```

Errors come back as JSON: `{"error": "...", "details": [...]}` with status 400 or 404.

## Scripts

| Command | What it does |
|---|---|
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Insert 50,000 products. Refuses on a non-empty table; `node scripts/seed.js --reset` empties it first |
| `npm run reprice -- --id 42 --price 19.99` | Set one product's price from the command line. Used by ops for price corrections |

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | see `.env.example` | MySQL connection. Docker Compose reads the same values |
| `REDIS_HOST` | `127.0.0.1` | Host of the Redis server the API uses for caching |
| `REDIS_PORT` | `6379` | Host port of the Redis container started by Docker Compose; the API connects to it |
| `SQL_LOG` | `0` | `1` prints every SQL query the application runs |

## Known issues

Traffic in production:

- `GET /api/products` and `GET /api/products/:id` are about 95% of all requests, around 200 requests per second at peak.
- `PATCH /api/products/:id` happens a few times per minute.
- Ops occasionally correct a price with `scripts/reprice.js`.

What the service does with that traffic:

- Every request runs its queries against MySQL, even when the identical page was served a moment ago. Run with `SQL_LOG=1` to see it.
- The data changes a few times per minute. The same data is read thousands of times per minute.
- Response time is almost entirely time spent waiting for the database, and the database is the one component that cannot be scaled by adding more API instances.

Measured on a developer machine with 50 concurrent clients requesting one list page for 10 seconds:

| Metric | Value |
|---|---|
| Requests per second | ~1,600 |
| Latency p50 | 29 ms |
| Latency p99 | 53 ms |
| MySQL CPU during the run | ~240% (2.4 cores) |

The catalog and the traffic both grow. Nothing in the service currently limits how often MySQL is asked the same question.

## Your task

Introduce caching for the read endpoints and understand its effect on performance and on data consistency. Time box: 2 to 3 working days.

Requirements:

1. Analyze the existing endpoints and identify what can benefit from caching.
2. Implement a caching strategy using a suitable solution, such as Redis.
3. Define an appropriate cache expiration policy.
4. Handle cache updates or invalidation when the underlying data changes.
5. Ensure the endpoints continue to work correctly when cached data is unavailable.
6. Compare performance before and after implementing caching.

Expected outcome:

- The endpoints return the same results as before, faster and with less database load under load.
- Changes made through the API are reflected in the responses that follow.
- If the cache server is unreachable, the API still returns correct data.
- Automated tests where they help you prove behaviour, for example that an update is reflected after it happens.
- A new section in this README covering:
  - how to run everything, including any new environment variables;
  - what you cached and why;
  - your cache key scheme, expiration values, and invalidation approach, with reasoning;
  - what happens when the cache is unavailable;
  - before and after measurements: tool, method, dataset, numbers;
  - known limitations, for example cases where stale data can still be served and for how long.

How we work:

- Research freely: official documentation first, anything else that helps. Keep a note of what you relied on.
- When blocked, ask a focused question and include what you already tried.
- Commit in small steps so the path you took is visible.
- At the end we review the implementation together. Be ready to walk through the code, explain the trade-offs you made, and name what you would do differently with more time.

## Caching

`GET /api/products` and `GET /api/products/:id` are cached in Redis. Repeated requests are answered from Redis without touching MySQL. Changes made with `PATCH` or `scripts/reprice.js` invalidate the affected entries, so the following responses show them. The exceptions are listed under [Known limitations](#known-limitations). For example, if invalidation fails because Redis can't be reached at that moment, old entries can be served until they expire: at most 300 s for a product and 60 s for a list page. If Redis is unavailable, the API keeps answering correctly from MySQL.

### How to run it

The steps under [Run it](#run-it) are unchanged. `docker compose up -d` starts MySQL and Redis, and `npm start` connects to both. The API doesn't wait for Redis: it starts without it, and connects or reconnects on its own. There is one new variable, `REDIS_HOST`, and `REDIS_PORT` is now also used by the API (see [Environment variables](#environment-variables)).

`npm test` runs 16 tests in under 10 s (Node.js 22+).
- They need the Docker Compose MySQL and Redis running and the seeded data. They start their own API instances.
- They change a few products in the `catalog` database and write the exact values back afterwards.
- They delete the API's cache keys (`catalog:*`) before each test and at the end.

To list the cached entries, or empty the cache (for example after reseeding):

```bash
docker compose exec redis redis-cli --scan --pattern 'catalog:*'
docker compose exec redis sh -c "redis-cli --scan --pattern 'catalog:*' | xargs -r redis-cli DEL"
```

### What is cached, and why

| Endpoint | Cached as | Why |
|---|---|---|
| `GET /api/products` | The whole response, once per combination of `category`, `sort`, `page` and `limit` | The heaviest request: a `COUNT(*)` over the category plus a sorted, paginated `SELECT`. It serves the shop's category pages, which are requested again and again. |
| `GET /api/products/:id` | The product, once per id | Part of the ~95% read traffic. Each lookup is cheap, but every repeat went to MySQL. |

Not cached:
- `PATCH`: it invalidates instead.
- `/health`: it must report the real database state.
- Errors: a 400 never reaches MySQL, and a 404 is one cheap lookup.

The cache stores the exact JSON text of each response (cache-aside, in `src/cache/index.js`), so responses are byte-for-byte the same as without caching.

### Keys, expiration and invalidation

| Entry | Key | Expires after |
|---|---|---|
| Product | `catalog:product:{id}` | 300 s |
| List page | `catalog:list:cat:{category}:v{version}:{sort}:{page}:{limit}`, or `catalog:list:all:v{version}:…` without a category | 60 s |
| Version counter | `catalog:list-version:{scope}`: one per category, plus `all` | never |

**Keys**
- Keys are built from the validated parameters, so equivalent requests share one entry: `?category=Toys` and `?category=toys`, or `/api/products` and `/api/products?sort=newest&page=1&limit=20`.
- Only categories made of `a–z` and `0–9` get their own scope. MySQL compares categories ignoring case and accents, so `?category=töys` returns the `toys` products. Any other spelling therefore goes into the `all` scope, with its URL-encoded category appended to the key.

**Expiration**
- It is set together with the value, and hits don't extend it. That makes it the longest a stale entry can be served when invalidation didn't happen (see [Known limitations](#known-limitations)).
- List pages expire sooner: a page shows many products, and there are far more list combinations than products.
- Products are invalidated one by one, and most of the 50,000 are viewed rarely, so they live longer.
- Popular entries still nearly always hit: a page requested once a second is reloaded once a minute.
- Version counters never expire. If one did, old pages could become current again.

**Invalidation** runs after every successful write, from `PATCH` and from `scripts/reprice.js`, before the response is sent or the script exits:
1. The product's entry is deleted, so the next read gets it from MySQL.
2. The version counters of the product's category and of `all` are incremented. Every cached page in those two scopes is replaced at once, and the old pages expire within 60 s.

Why invalidation works this way:
- A product's category never changes, and the app never adds or removes products. A change can therefore only affect its own category's pages and the unfiltered pages; other categories stay cached.
- Within those two scopes, all pages are dropped, because a price change re-sorts the price-ordered pages and can move the product to another page.
- Incrementing a version takes one command, however many pages are cached. And no slow request can store an outdated page afterwards: it would be stored under the old version, which is never read again.

### When Redis is unavailable

The API keeps answering correctly from MySQL; Redis only makes it faster.
- **Start-up:** the API doesn't wait for Redis, and keeps reconnecting in the background, with pauses growing to about 2 s.
- **Redis stopped:** Redis calls fail at once instead of queuing. Reads come from MySQL. A `PATCH` is saved and returned, and logs `Cache not invalidated for product …`.
- **Redis frozen** (connected but not answering): each Redis call waits at most 200 ms, then the request continues with MySQL. Once 1,000 commands are waiting, new requests skip Redis at once.
- **`scripts/reprice.js`:** it sets the price, waits at most 2 s for Redis, invalidates or warns, and exits.

Checked by `test/redis-unavailable.test.js` and by hand:
- With Redis stopped, requests answered in under 5 ms.
- With Redis frozen, they answered in about 0.21 s. Under load there were 1,897 requests, 0 errors and a p99 of 283 ms.
- Both times, the API recovered on its own once Redis was back.

During an outage, every read goes to MySQL, so the database is back to its load without caching.

### Before and after

- **Tool:** autocannon 8.0.0.
- **Method:** the one described in [Known issues](#known-issues): 50 concurrent connections on one list page for 10 s (autocannon runs about 11 s).
  - Each measurement starts a fresh API with `SQL_LOG=0`, runs a 30 s warm-up that isn't recorded, then 3 measured runs 3 s apart.
  - "Before" ran on the original code (commit `9283b03`). "After" ran on the current code, starting with an empty cache.
  - MySQL CPU is the MySQL container's CPU time during a run divided by the run's duration (100% = one core, the scale `docker stats` uses).
- **Dataset:** the 50,000 seeded products (4,242 in `toys`), the same data for both.
- **Machine:** Intel Core i3-10100 (4 cores, 8 threads), 15 GiB RAM, Linux, Node.js 24.21.0, with MySQL 8.4.13 and Redis 7.4.12 in Docker. The load generator ran on the same machine.

```bash
SQL_LOG=0 PORT=4001 npm start          # terminal 1: a fresh API
docker stats catalog-api-mysql-1       # terminal 2: MySQL CPU during the runs
URL='http://localhost:4001/api/products?category=toys&sort=price_asc&page=2&limit=2'
npx autocannon@8.0.0 -c 50 -d 30 "$URL"                                      # warm-up: not recorded
for run in 1 2 3; do npx autocannon@8.0.0 -c 50 -d 10 "$URL"; sleep 3; done   # the 3 measured runs
```

| Run | Requests/s | p50 | p99 | Failed | MySQL CPU |
|---|---|---|---|---|---|
| Before 1 | 1,986 | 24 ms | 30 ms | 0 | 222% |
| Before 2 | 1,990 | 24 ms | 32 ms | 0 | 223% |
| Before 3 | 1,992 | 24 ms | 31 ms | 0 | 224% |
| **Before, median** | **1,990** | **24 ms** | **31 ms** | **0** | **223%** |
| After 1 | 14,111 | 3 ms | 8 ms | 0 | 1% |
| After 2 | 14,912 | 3 ms | 7 ms | 0 | 1% |
| After 3 | 15,455 | 2 ms | 5 ms | 0 | 1% |
| **After, median** | **14,912** | **3 ms** | **7 ms** | **0** | **1%** |

Each median is taken per column. Failed counts errors (including timeouts) plus non-2xx responses.

With the cache:
- Throughput is 7.5× higher, p50 is 8× lower and p99 is 4.4× lower.
- MySQL is almost idle. The page came from Redis, apart from one reload when its 60 s expiry ran out.
- The limit is now the single API process, at about one full CPU core, as before. Redis used 5–6% of a core and the load generator about 40%.

This is a best case: one popular page and no writes. Real traffic spreads over many pages and products, and each change reloads its category's pages, so the hit ratio will be lower.

### Known limitations

Stale data can still be served in these cases:

| Case | For how long |
|---|---|
| Data changed outside the app: direct SQL, or reseeding (`node scripts/seed.js --reset`, `npm run db:reset`) | Up to 300 s for a product and 60 s for a list page. After reseeding, empty the cache (see [How to run it](#how-to-run-it)). |
| A change made while the API couldn't reach Redis. The old entries stay in Redis, and a restarted Redis container still has them, because the Redis image saves its data to disk by default. | Up to 300 s / 60 s from when they were stored |
| A request that read a product just before a `PATCH` stores it again just after the invalidation | Up to 300 s. Products only: an outdated list page would be stored under the old version. |

Also:
- **Frozen Redis:** each request waits up to 200 ms until 1,000 commands are waiting. No circuit breaker stops trying sooner.
- **Coarse invalidation:** a change drops every page of its category and every unfiltered page, even those that don't show the product.
- **No request coalescing:** when a popular entry expires or is invalidated, every request that arrives before it is reloaded queries MySQL.
- **Unbounded key space:** any `category`, `page` or `limit` value creates its own entry. Each expires within 60 s, but Docker Compose sets no memory limit for Redis.
