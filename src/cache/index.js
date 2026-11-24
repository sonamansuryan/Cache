// Caches the JSON bodies of the read endpoints in Redis (cache-aside). On a hit the
// stored JSON is returned as is. On a miss, `load` reads MySQL, and its JSON is stored
// with an expiry time before it is returned. Errors from `load` (such as a 404) are
// thrown before anything is stored, so they are never cached.
const redis = require('./redis');
const { productKey, listKey, listScope, listVersionKey } = require('./keys');

// How long a cached response may be served after it was read from MySQL. Hits don't
// extend it, so this is also the longest a stale entry can survive.
const PRODUCT_TTL_SECONDS = 300;
const LIST_TTL_SECONDS = 60;

async function readThrough(key, load, ttlSeconds) {
  const cached = await redis.get(key);
  if (cached !== null) return cached;
  const json = JSON.stringify(await load());
  await redis.set(key, json, { expiration: { type: 'EX', value: ttlSeconds } });
  return json;
}

// A list key includes its scope's version. A counter that doesn't exist yet counts as 0.
async function listResponse(query, load) {
  const version = Number(await redis.get(listVersionKey(listScope(query.category)))) || 0;
  return readThrough(listKey(query, version), load, LIST_TTL_SECONDS);
}

const productResponse = (id, load) => readThrough(productKey(id), load, PRODUCT_TTL_SECONDS);

// After a product changed in MySQL: delete its cached entry, and move the two list
// scopes that can show it (its category, and the unfiltered lists) to a new version.
// Their old pages are never read again and expire through their TTL.
async function invalidateProduct({ id, category }) {
  const scopes = new Set([listScope(category), listScope()]);
  const tx = redis.multi().del(productKey(id));
  for (const scope of scopes) tx.incr(listVersionKey(scope));
  await tx.exec();
}

module.exports = { listResponse, productResponse, invalidateProduct };
