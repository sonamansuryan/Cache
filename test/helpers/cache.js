// A Redis connection for the tests, with the app's settings from .env. It removes the
// app's cache entries (keys starting with `catalog:`, see src/cache/keys.js) and lets
// tests see what is stored.
require('dotenv').config({ quiet: true });
const { createClient } = require('redis');

const PATTERN = 'catalog:*';

const client = createClient({
  socket: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    reconnectStrategy: false, // if Redis isn't running, fail at once instead of retrying
  },
});
// node-redis requires an error listener. Failures still reach the tests as rejected calls.
client.on('error', () => {});

let connecting;
const connected = () => (connecting ??= client.connect());

// Every cache key the app has stored, sorted.
async function keys() {
  await connected();
  const found = [];
  for await (const batch of client.scanIterator({ MATCH: PATTERN, COUNT: 100 })) found.push(...batch);
  return found.sort();
}

// The stored text for `key`, or null if there is none.
async function get(key) {
  await connected();
  return client.get(key);
}

// Time until `key` expires: TTL in seconds, PTTL in milliseconds.
// -1 means the key has no expiry; -2 means there is no such key.
async function ttl(key) {
  await connected();
  return client.ttl(key);
}

async function pttl(key) {
  await connected();
  return client.pTTL(key);
}

// Removes every cache key the app has stored, and nothing else in Redis.
async function clear() {
  const found = await keys();
  if (found.length > 0) await client.del(found);
}

async function close() {
  if (client.isOpen) await client.close();
}

module.exports = { keys, get, ttl, pttl, clear, close };
