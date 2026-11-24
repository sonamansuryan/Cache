// Checks the test setup itself:
// - the API runs on a test port and answers over HTTP
// - each request reports the SQL it ran
// - every test starts with an empty cache, and the stored entries can be read
// - product changes made by a test are put back afterwards
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApi } = require('./helpers/api');
const db = require('./helpers/db');
const cache = require('./helpers/cache');

let api;

before(async () => {
  api = await startApi();
});

// Every test starts with an empty cache, so a first request always goes to MySQL.
beforeEach(() => cache.clear());

after(async () => {
  await api?.stop();
  await db.close();
  await cache.clear(); // leave no entries behind, because restores write to MySQL directly
  await cache.close();
});

test('the API runs on a test port and answers over HTTP', async () => {
  const res = await fetch(`${api.baseUrl}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('each request reports the SQL it sent to MySQL', async () => {
  const list = await api.request('GET', '/api/products?category=toys&sort=price_asc&page=2&limit=2');
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 2);
  assert.equal(list.sql.length, 2);
  assert.match(list.sql[0], /^SELECT count\(\*\)/);
  assert.match(list.sql[1], /ORDER BY .* LIMIT 2, 2;$/);

  const id = list.body.items[0].id;
  const detail = await api.request('GET', `/api/products/${id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.id, id);
  assert.equal(detail.sql.length, 1);
  const [, queriedId] = detail.sql[0].match(/WHERE `Product`\.`id` = (\d+);$/);
  assert.equal(Number(queriedId), id);
});

test('each test starts with an empty cache, and stored entries can be read', async () => {
  // The previous test stored a list page and a product; beforeEach removed them.
  assert.deepEqual(await cache.keys(), []);

  const res = await api.request('GET', '/api/products/123');
  assert.equal(res.status, 200);
  assert.deepEqual(await cache.keys(), ['catalog:product:123']);
  assert.deepEqual(JSON.parse(await cache.get('catalog:product:123')), res.body);
});

test('product values changed by a test are put back after it', async (t) => {
  const { body } = await api.request('GET', '/api/products?limit=1');
  const id = body.items[0].id;
  const original = await db.snapshotProduct(id);

  await t.test('a test that changes the product', async (st) => {
    await db.restoreAfter(st, id);
    const res = await api.request('PATCH', `/api/products/${id}`, {
      price: original.price + 1,
      stock: original.stock + 1,
    });
    assert.equal(res.status, 200);
    assert.notDeepEqual(await db.snapshotProduct(id), original);
  });

  assert.deepEqual(await db.snapshotProduct(id), original);
});
