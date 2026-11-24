const { createClient } = require('redis');

const host = process.env.REDIS_HOST || '127.0.0.1';
const port = Number(process.env.REDIS_PORT) || 6379;

const redis = createClient({
  socket: { host, port },
  // While Redis is unreachable, reject commands at once instead of queuing them until it returns.
  disableOfflineQueue: true,
  // If Redis stops answering, unanswered commands pile up here. Beyond this many, new
  // commands are rejected at once. Normal load keeps well under 100 commands in flight.
  commandsQueueMaxLength: 1000,
});

// node-redis requires an error listener: without one, a connection error would crash the process.
redis.on('error', (err) => console.error('Redis error:', err.message || err.code));
redis.on('ready', () => console.log(`Connected to Redis at ${host}:${port}`));

module.exports = redis;
