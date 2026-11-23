// Starts the real API (src/index.js) in a child process for the tests: on a free
// port (PORT), against the MySQL configured in .env (the docker-compose service
// with its seeded data), and with SQL_LOG=1 so every query it runs is logged.
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SQL_LINE = /^Executing \([^)]*\): /;
const HEALTH_SQL_LINE = /^Executing \([^)]*\): SELECT 1;?$/;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startApi() {
  const port = await freePort();
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), SQL_LOG: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const killChild = () => child.kill();
  process.on('exit', killChild);

  const lines = []; // every stdout line the API has printed, in order
  const listeners = new Set();
  let partial = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    const parts = (partial + chunk).split('\n');
    partial = parts.pop();
    lines.push(...parts);
    for (const listener of listeners) listener();
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  // Resolves with the index of the first line at or after `from` that matches.
  function waitForLine(pattern, from, what, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${what}.\n${stderr}`)), timeoutMs);
      const onExit = (code, signal) =>
        finish(new Error(`The API exited (${code ?? signal}) while waiting for ${what}.\n${stderr}`));
      const check = () => {
        for (let i = from; i < lines.length; i++) {
          if (pattern.test(lines[i])) return finish(null, i);
        }
      };
      function finish(err, index) {
        clearTimeout(timer);
        listeners.delete(check);
        child.off('exit', onExit);
        if (err) reject(err);
        else resolve(index);
      }
      listeners.add(check);
      child.once('exit', onExit);
      check();
    });
  }

  await waitForLine(/^catalog-api listening on /, 0, 'the API to start', 15000);
  const baseUrl = `http://localhost:${port}`;

  async function send(method, urlPath, body) {
    const res = await fetch(baseUrl + urlPath, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  }

  // GET /health always runs `SELECT 1` against MySQL. stdout is one ordered
  // stream, so once that line arrives, everything logged before it has arrived
  // too. Returns the index of that line.
  async function logBarrier() {
    const from = lines.length;
    await send('GET', '/health');
    return waitForLine(HEALTH_SQL_LINE, from, 'the SQL log to catch up');
  }

  // Sends a request and returns { status, body, sql }. `sql` lists the statements
  // the API sent to MySQL while handling it; [] means MySQL was not queried.
  // Don't use it for GET /health, which serves as the barrier.
  async function request(method, urlPath, body) {
    const start = (await logBarrier()) + 1;
    const res = await send(method, urlPath, body);
    const end = await logBarrier();
    const sql = lines
      .slice(start, end)
      .filter((line) => SQL_LINE.test(line))
      .map((line) => line.replace(SQL_LINE, ''));
    return { ...res, sql };
  }

  async function stop() {
    process.off('exit', killChild);
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => {
      child.once('exit', resolve);
      child.kill();
    });
  }

  return { port, baseUrl, request, stop };
}

module.exports = { startApi };
