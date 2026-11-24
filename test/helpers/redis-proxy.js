// A TCP proxy in front of the docker-compose Redis, for tests. While frozen, it holds
// the commands it receives, so Redis looks connected but never answers, like a frozen
// server. unfreeze() forwards the held commands in their original order and resumes.
require('dotenv').config({ quiet: true });
const net = require('node:net');

async function startRedisProxy() {
  const target = { host: process.env.REDIS_HOST || '127.0.0.1', port: Number(process.env.REDIS_PORT) || 6379 };
  const sockets = new Set();
  let frozen = false;
  let held = []; // [upstream socket, data] received while frozen, in arrival order

  const server = net.createServer((client) => {
    const upstream = net.connect(target);
    sockets.add(client);
    sockets.add(upstream);
    client.on('data', (data) => (frozen ? held.push([upstream, data]) : upstream.write(data)));
    upstream.on('data', (data) => client.write(data));
    const close = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    for (const socket of [client, upstream]) {
      socket.on('error', close);
      socket.on('close', close);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    port: server.address().port,
    freeze() {
      frozen = true;
    },
    unfreeze() {
      frozen = false;
      for (const [upstream, data] of held) upstream.write(data);
      held = [];
    },
    close() {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { startRedisProxy };
