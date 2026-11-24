// Changes reach the cache. After a PATCH or a reprice, the product's cached entry is
// deleted, and the list scopes that can show it (its category and the unfiltered
// lists) move to a new version. Lists of other categories stay cached.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { startApi } = require('./helpers/api');
const cache = require('./helpers/cache');
const db = require('./helpers/db');

const ROOT = path.join(__dirname, '..');

let api;

before(async () => {
  api = await startApi();
});

beforeEach(() => cache.clear());

after(async () => {
  await api?.stop();
  await db.close();
  await cache.clear();
  await cache.close();
});

// The newest product is the first item of the unfiltered list and of its category's list.
// Reading it this way also caches the unfiltered page `?limit=1`.
async function newestProduct() {
  const { body } = await api.request('GET', '/api/products?limit=1');
  return body.items[0];
}

const otherCategory = (category) => (category === 'books' ? 'toys' : 'books');
const plusCents = (price, amount) => Math.round((price + amount) * 100) / 100;

function runReprice(id, price) {
  const args = ['run', 'reprice', '--', '--id', String(id), '--price', String(price)];
  return new Promise((resolve, reject) => {
    execFile('npm', args, { cwd: ROOT }, (err, stdout, stderr) =>
      err ? reject(new Error(`reprice failed: ${err.message}\n${stdout}${stderr}`)) : resolve(stdout),
    );
  });
}

test('PATCH deletes the product entry and bumps the versions of its category and of unfiltered lists; other categories stay cached', async (t) => {
  const product = await newestProduct();
  const { category } = product;
  const categoryPage = `/api/products?category=${category}&limit=1`;
  const unfilteredPage = '/api/products?limit=1';
  const otherPage = `/api/products?category=${otherCategory(category)}&limit=1`;
  await db.restoreAfter(t, product.id);

  await api.request('GET', `/api/products/${product.id}`);
  await api.request('GET', categoryPage);
  const otherBefore = await api.request('GET', otherPage);

  const price = plusCents(product.price, 1);
  const stock = product.stock + 1;
  const patch = await api.request('PATCH', `/api/products/${product.id}`, { price, stock });
  assert.equal(patch.status, 200);

  const detail = await api.request('GET', `/api/products/${product.id}`);
  assert.equal(detail.sql.length, 1, 'the product is read from MySQL again');
  assert.deepEqual([detail.body.price, detail.body.stock], [price, stock]);

  for (const url of [categoryPage, unfilteredPage]) {
    const page = await api.request('GET', url);
    assert.equal(page.sql.length, 2, `${url} is read from MySQL again`);
    const item = page.body.items.find((i) => i.id === product.id);
    assert.deepEqual([item.price, item.stock], [price, stock], url);
  }

  const other = await api.request('GET', otherPage);
  assert.deepEqual(other.sql, [], "another category's page is still served from the cache");
  assert.deepEqual(other.body, otherBefore.body);

  assert.equal(await cache.get(`catalog:list-version:cat:${category}`), '1');
  assert.equal(await cache.get('catalog:list-version:all'), '1');
  assert.equal(await cache.get(`catalog:list-version:cat:${otherCategory(category)}`), null);
  assert.equal(await cache.ttl(`catalog:list-version:cat:${category}`), -1, 'version counters never expire');
  assert.equal(await cache.ttl('catalog:list-version:all'), -1, 'version counters never expire');
});

test('scripts/reprice.js deletes the product entry and bumps the versions of its category and of unfiltered lists', async (t) => {
  const product = await newestProduct();
  const categoryPage = `/api/products?category=${product.category}&limit=1`;
  await db.restoreAfter(t, product.id);

  await api.request('GET', `/api/products/${product.id}`);
  await api.request('GET', categoryPage);

  const price = plusCents(product.price, 2);
  const output = await runReprice(product.id, price);
  assert.ok(output.includes(`product ${product.id}: price set to ${price.toFixed(2)}`), output);

  const detail = await api.request('GET', `/api/products/${product.id}`);
  assert.equal(detail.sql.length, 1, 'the product is read from MySQL again');
  assert.equal(detail.body.price, price);

  const page = await api.request('GET', categoryPage);
  assert.equal(page.sql.length, 2, 'its category page is read from MySQL again');
  assert.equal(page.body.items.find((i) => i.id === product.id).price, price);

  assert.equal(await cache.get(`catalog:list-version:cat:${product.category}`), '1');
  assert.equal(await cache.get('catalog:list-version:all'), '1');
});
