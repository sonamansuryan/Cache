// Caches the JSON bodies of the read endpoints in Redis (cache-aside). On a hit the
// stored JSON is returned as is. On a miss, `load` reads MySQL, and its JSON is stored
// with an expiry time before it is returned. Errors from `load` (such as a 404) are
// thrown before anything is stored, so they are never cached.
//
// Redis is optional. If it is unreachable or doesn't answer in time, reads come straight
// from MySQL and writes still succeed. Only Redis errors are caught here.
const redis = require('./redis');
const { productKey, listKey, listScope, listVersionKey } = require('./keys');

// How long a cached response may be served after it was read from MySQL. Hits don't
// extend it, so this is also the longest a stale entry can survive.
const PRODUCT_TTL_SECONDS = 300;
const LIST_TTL_SECONDS = 60;

// node-redis stops timing a command once it has been sent, so a Redis that accepts
// commands but never answers would hold a request forever. Each Redis call waits at
// most this long; then the request carries on without the cache. Redis normally
// answers in well under 1 ms.
const REDIS_TIMEOUT_MS = 200;

function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis did not answer within ${REDIS_TIMEOUT_MS} ms`)), REDIS_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const fromMySQL = async (load) => JSON.stringify(await load());

async function readThrough(key, load, ttlSeconds) {
  let cached;
  try {
    cached = await withTimeout(redis.get(key));
  } catch {
    return fromMySQL(load); // Redis unavailable: skip the cache for this request
  }
  if (cached !== null) return cached;
  const json = await fromMySQL(load);
  try {
    await withTimeout(redis.set(key, json, { expiration: { type: 'EX', value: ttlSeconds } }));
  } catch {
    // Not stored: the next request reads MySQL again. This response is still correct.
  }
  return json;
}

// A list key includes its scope's version. A counter that doesn't exist yet counts as 0.
async function listResponse(query, load) {
  let version;
  try {
    version = Number(await withTimeout(redis.get(listVersionKey(listScope(query.category))))) || 0;
  } catch {
    return fromMySQL(load); // Redis unavailable: skip the cache for this request
  }
  return readThrough(listKey(query, version), load, LIST_TTL_SECONDS);
}

const productResponse = (id, load) => readThrough(productKey(id), load, PRODUCT_TTL_SECONDS);

// After a product changed in MySQL: delete its cached entry, and move the two list
// scopes that can show it (its category, and the unfiltered lists) to a new version.
// Their old pages are never read again and expire through their TTL.
//
// The commands are sent together in one round trip. They are not a MULTI transaction,
// because node-redis queues a MULTI even while disconnected instead of failing at once.
// If Redis is unavailable, the change in MySQL still stands, and old entries can be
// served until they expire.
async function invalidateProduct({ id, category }) {
  const scopes = [...new Set([listScope(category), listScope()])];
  try {
    await withTimeout(
      Promise.all([redis.del(productKey(id)), ...scopes.map((scope) => redis.incr(listVersionKey(scope)))]),
    );
  } catch (err) {
    console.error(
      `Cache not invalidated for product ${id} (${err.message || err.name}); old entries can be served until they expire`,
    );
  }
}

module.exports = { listResponse, productResponse, invalidateProduct };
