// Redis is optional:
// - With nothing listening on the API's Redis port, the API still starts, and reads
//   and writes return correct data quickly, straight from MySQL.
// - scripts/reprice.js still sets the price, warns, and exits.
// - If Redis stops answering on an open connection (frozen), each request waits at
//   most 200 ms for it, and is correct again once Redis answers.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { startApi, freePort } = require('./helpers/api');
const { startRedisProxy } = require('./helpers/redis-proxy');
const cache = require('./helpers/cache');
const db = require('./helpers/db');

const ROOT = path.join(__dirname, '..');
// Far below node-redis's default 5 s command timeout, and well above what MySQL needs here.
const FAST_MS = 1000;
// A hanging request fails the test instead of stalling the whole run.
const TEST_TIMEOUT = { timeout: 20_000 };

let api; // Redis available
let apiWithoutRedis; // its Redis port points at a port where nothing listens
let apiThroughProxy; // reaches Redis through a proxy that the frozen-Redis test freezes
let proxy;
let unusedPort;

before(async () => {
  unusedPort = String(await freePort());
  proxy = await startRedisProxy();
  [api, apiWithoutRedis, apiThroughProxy] = await Promise.all([
    startApi(),
    startApi({ env: { REDIS_PORT: unusedPort }, redis: false }),
    startApi({ env: { REDIS_PORT: String(proxy.port) } }),
  ]);
});

beforeEach(() => cache.clear());

after(async () => {
  proxy?.unfreeze();
  await Promise.all([api?.stop(), apiWithoutRedis?.stop(), apiThroughProxy?.stop()]);
  await proxy?.close();
  await db.close();
  await cache.clear();
  await cache.close();
});

async function timed(send) {
  const start = Date.now();
  const res = await send();
  return { ...res, ms: Date.now() - start };
}

async function newestProduct() {
  const { body } = await apiWithoutRedis.request('GET', '/api/products?limit=1');
  return body.items[0];
}

const plusCents = (price, amount) => Math.round((price + amount) * 100) / 100;

function runReprice(id, price, env) {
  const args = ['run', 'reprice', '--', '--id', String(id), '--price', String(price)];
  const options = { cwd: ROOT, env: { ...process.env, ...env }, timeout: 15_000 };
  return new Promise((resolve, reject) => {
    execFile('npm', args, options, (err, stdout, stderr) =>
      err ? reject(new Error(`reprice failed: ${err.message}\n${stdout}${stderr}`)) : resolve(stdout + stderr),
    );
  });
}

test('without Redis, GET requests return the same data as with Redis, quickly and straight from MySQL', TEST_TIMEOUT, async () => {
  const cases = [
    ['/api/products?category=toys&sort=price_asc&page=2&limit=2', 2],
    ['/api/products', 2],
    ['/api/products/123', 1],
  ];
  for (const [url, statements] of cases) {
    const expected = await api.request('GET', url);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await timed(() => apiWithoutRedis.request('GET', url));
      assert.equal(res.status, 200, url);
      assert.ok(res.ms < FAST_MS, `${url} took ${res.ms} ms`);
      assert.equal(res.sql.length, statements, `${url} is read from MySQL every time`);
      assert.deepEqual(res.body, expected.body, url);
    }
  }
});

test('without Redis, PATCH saves the change quickly, and the next GET shows it', TEST_TIMEOUT, async (t) => {
  const product = await newestProduct();
  await db.restoreAfter(t, product.id);
  const price = plusCents(product.price, 1);
  const stock = product.stock + 1;

  const patch = await timed(() => apiWithoutRedis.request('PATCH', `/api/products/${product.id}`, { price, stock }));
  assert.equal(patch.status, 200);
  assert.ok(patch.ms < FAST_MS, `PATCH took ${patch.ms} ms`);
  assert.deepEqual([patch.body.price, patch.body.stock], [price, stock]);

  const saved = await db.snapshotProduct(product.id);
  assert.deepEqual([saved.price, saved.stock], [price, stock], 'the change is saved in MySQL');

  const next = await apiWithoutRedis.request('GET', `/api/products/${product.id}`);
  assert.equal(next.status, 200);
  assert.deepEqual([next.body.price, next.body.stock], [price, stock]);
});

test('without Redis, scripts/reprice.js still sets the price, warns, and exits', TEST_TIMEOUT, async (t) => {
  const product = await newestProduct();
  await db.restoreAfter(t, product.id);
  const price = plusCents(product.price, 2);

  const start = Date.now();
  const output = await runReprice(product.id, price, { REDIS_PORT: unusedPort });
  const ms = Date.now() - start;
  assert.ok(output.includes(`product ${product.id}: price set to ${price.toFixed(2)}`), output);
  assert.ok(output.includes(`Cache not invalidated for product ${product.id}`), output);
  assert.ok(ms < 10_000, `reprice took ${ms} ms`);
  assert.equal((await db.snapshotProduct(product.id)).price, price, 'the new price is saved in MySQL');
});

test('with Redis frozen (connected, never answering), requests answer within 1 s and stay correct', TEST_TIMEOUT, async () => {
  const listUrl = '/api/products?category=toys&sort=price_asc&page=2&limit=2';
  const productUrl = '/api/products/123';
  const list = await apiThroughProxy.request('GET', listUrl);
  const product = await apiThroughProxy.request('GET', productUrl);
  assert.deepEqual((await apiThroughProxy.request('GET', listUrl)).sql, [], 'cached through the proxy before freezing');

  proxy.freeze();
  try {
    for (const [url, statements, expected] of [
      [listUrl, 2, list.body],
      [productUrl, 1, product.body],
    ]) {
      const res = await timed(() => apiThroughProxy.request('GET', url));
      assert.equal(res.status, 200, url);
      // At least ~200 ms: it really waited for the frozen Redis, then gave up on it.
      assert.ok(res.ms >= 150 && res.ms < FAST_MS, `${url} took ${res.ms} ms`);
      assert.equal(res.sql.length, statements, `${url} is read from MySQL`);
      assert.deepEqual(res.body, expected, url);
    }
    // Same values: the update succeeds, and only its invalidation waits for Redis.
    const { price, stock } = product.body;
    const patch = await timed(() => apiThroughProxy.request('PATCH', productUrl, { price, stock }));
    assert.equal(patch.status, 200);
    assert.ok(patch.ms < FAST_MS, `PATCH took ${patch.ms} ms`);
  } finally {
    proxy.unfreeze();
  }

  // The late replies to the held commands must not be mixed up with new ones.
  assert.deepEqual((await apiThroughProxy.request('GET', listUrl)).body, list.body, 'correct once Redis answers');
  const again = await apiThroughProxy.request('GET', listUrl);
  assert.deepEqual(again.sql, [], 'served from Redis again');
  assert.deepEqual(again.body, list.body);
});
