import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { request, Agent } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));

async function startServer(argumentsList = ['--port', '0']) {
  const child = spawn(process.execPath, [serverPath, ...argumentsList], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.setEncoding('utf8');
  for await (const chunk of child.stdout) {
    output += chunk;
    const match = /http:\/\/127\.0\.0\.1:(\d+)/u.exec(output);
    if (match) return { child, port: Number(match[1]) };
  }
  throw new Error('The server did not start.');
}

function get(port, path, { method = 'GET', headers = {}, agent } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, path, method, headers, agent }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

test('the dev server serves only its public files, with strict headers', async (t) => {
  const { child, port } = await startServer();
  t.after(() => child.kill());

  const page = await get(port, '/');
  assert.equal(page.status, 200);
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(page.headers['content-security-policy'], /connect-src 'none'/);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.equal(page.headers['cache-control'], 'no-store');

  for (const [path, type] of [['/src/app.js', 'text/javascript'], ['/src/core.js', 'text/javascript'], ['/src/sample.js', 'text/javascript'], ['/src/styles.css', 'text/css']]) {
    const response = await get(port, path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers['content-type'], new RegExp(type), path);
  }

  for (const path of ['/server.mjs', '/package.json', '/../package.json', '/%2e%2e/package.json', '/fixtures/release-note.txt', '/src/cli.js']) {
    const response = await get(port, path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers['x-content-type-options'], 'nosniff', path);
  }
  assert.equal((await get(port, '/%E0%A4%A')).status, 400);
});

test('only GET and HEAD requests for the local address are answered', async (t) => {
  const { child, port } = await startServer();
  t.after(() => child.kill());

  const post = await get(port, '/', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');

  const head = await get(port, '/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');

  assert.equal((await get(port, '/', { headers: { Host: 'evil.test' } })).status, 421);
  assert.equal((await get(port, '/', { headers: { Host: `evil.test:${port}` } })).status, 421);
  assert.equal((await get(port, '/', { headers: { Host: `localhost:${port}` } })).status, 200);
});

test('port problems are explained instead of crashing', async (t) => {
  const { child, port } = await startServer();
  t.after(() => child.kill());

  const busy = spawnSync(process.execPath, [serverPath, '--port', String(port)], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(busy.status, 1);
  assert.match(busy.stderr, /already in use/);
  assert.doesNotMatch(busy.stderr, /node:events|Unhandled/);

  for (const argumentsList of [['--port', 'abc'], ['--port=70000'], ['--port', '-1'], ['--verbose']]) {
    const invalid = spawnSync(process.execPath, [serverPath, ...argumentsList], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(invalid.status, 2, argumentsList.join(' '));
  }
  const environment = spawnSync(process.execPath, [serverPath], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, PORT: 'eighty' } });
  assert.equal(environment.status, 2);
  assert.match(environment.stderr, /PORT must be a whole number/);
});

test('the server stops promptly even while a browser keeps a connection open', async () => {
  const { child, port } = await startServer();
  const agent = new Agent({ keepAlive: true });
  await get(port, '/', { agent });
  const started = performance.now();
  child.kill('SIGTERM');
  const [code] = await once(child, 'exit');
  agent.destroy();
  assert.equal(code, 0);
  assert.ok(performance.now() - started < 2_000);
});
