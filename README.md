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
| `REDIS_PORT` | `6379` | Host port of the Redis container started by Docker Compose. The application does not use Redis today |
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
