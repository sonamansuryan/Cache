// The read endpoints are cached. A first request is a miss: it queries MySQL and
// stores the response in Redis. An identical second request is a hit: it returns
// the same body without sending any SQL. Cached responses match the uncached ones,
// and different parameters never share an entry.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApi } = require('./helpers/api');
const cache = require('./helpers/cache');

const README_PAGE = '/api/products?category=toys&sort=price_asc&page=2&limit=2';
// The README page with exactly one parameter changed.
const ONE_PARAMETER_CHANGED = [
  '/api/products?category=toys&sort=price_asc&page=3&limit=2',
  '/api/products?category=toys&sort=price_asc&page=2&limit=3',
  '/api/products?category=toys&sort=price_desc&page=2&limit=2',
  '/api/products?category=books&sort=price_asc&page=2&limit=2',
];
const LIST_URLS = [
  '/api/products',
  '/api/products?sort=price_asc',
  '/api/products?sort=price_desc&page=2&limit=5',
  '/api/products?category=toys',
  README_PAGE,
  ...ONE_PARAMETER_CHANGED,
  '/api/products?category=garden&sort=newest&page=50&limit=20',
  // MySQL returns the toys rows for `töys`; it must still get its own entry.
  '/api/products?category=t%C3%B6ys&sort=price_asc&page=2&limit=2',
  '/api/products?category=nosuchcategory',
];
const PRODUCT_URLS = [1, 2, 123, 4242, 25000, 50000].map((id) => `/api/products/${id}`);

let api;

before(async () => {
  api = await startApi();
});

beforeEach(() => cache.clear());

after(async () => {
  await api?.stop();
  await cache.clear();
  await cache.close();
});

test('GET /api/products: a miss queries MySQL and stores the page; a hit comes from Redis', async () => {
  const url = '/api/products?category=toys&sort=price_asc&page=2&limit=2';
  const key = 'catalog:list:cat:toys:v0:price_asc:2:2';

  const miss = await api.request('GET', url);
  assert.equal(miss.status, 200);
  assert.equal(miss.sql.length, 2, 'COUNT(*) for total plus the page SELECT');
  assert.deepEqual(await cache.keys(), [key]);
  assert.equal(await cache.get(key), JSON.stringify(miss.body));

  const hit = await api.request('GET', url);
  assert.equal(hit.status, 200);
  assert.deepEqual(hit.sql, []);
  assert.deepEqual(hit.body, miss.body);
});

// Reads each URL with an empty cache, so the response comes straight from MySQL.
// Then reads all the URLs side by side: once to store them, and once more from
// Redis. Every response must equal that URL's uncached response, and no URL may
// be answered from another URL's entry.
async function checkAgainstUncached(urls, sqlPerMiss) {
  const uncached = new Map();
  for (const url of urls) {
    await cache.clear();
    const res = await api.request('GET', url);
    assert.equal(res.status, 200, url);
    assert.equal(res.sql.length, sqlPerMiss, `${url}: with an empty cache it must read MySQL`);
    uncached.set(url, res.body);
  }

  await cache.clear();
  for (const url of urls) {
    const res = await api.request('GET', url);
    assert.equal(res.sql.length, sqlPerMiss, `${url}: must be a miss, not another URL's entry`);
    assert.deepEqual(res.body, uncached.get(url), url);
  }
  assert.equal((await cache.keys()).length, urls.length, 'one entry per URL');

  for (const url of urls) {
    const res = await api.request('GET', url);
    assert.deepEqual(res.sql, [], `${url}: must be a hit`);
    assert.deepEqual(res.body, uncached.get(url), url);
  }
  return uncached;
}

test('GET /api/products: cached pages match the uncached MySQL pages, and no two combinations share an entry', async () => {
  const uncached = await checkAgainstUncached(LIST_URLS, 2);
  // These pages really differ from the README page, so a mix-up would have been caught.
  for (const url of ONE_PARAMETER_CHANGED) assert.notDeepEqual(uncached.get(url), uncached.get(README_PAGE), url);
});

test('GET /api/products/:id: cached products match the uncached MySQL products, and no two ids share an entry', async () => {
  await checkAgainstUncached(PRODUCT_URLS, 1);
});

test('GET /api/products/:id: a miss queries MySQL and stores the product; a hit comes from Redis', async () => {
  const url = '/api/products/123';
  const key = 'catalog:product:123';

  const miss = await api.request('GET', url);
  assert.equal(miss.status, 200);
  assert.equal(miss.sql.length, 1, 'SELECT by primary key');
  assert.deepEqual(await cache.keys(), [key]);
  assert.equal(await cache.get(key), JSON.stringify(miss.body));

  const hit = await api.request('GET', url);
  assert.equal(hit.status, 200);
  assert.deepEqual(hit.sql, []);
  assert.deepEqual(hit.body, miss.body);
});
