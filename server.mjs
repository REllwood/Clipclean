import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const host = '127.0.0.1';
const defaultPort = 4176;
const types = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8']
]);
const publicFiles = new Map([
  ['/', resolve(root, 'index.html')],
  ['/index.html', resolve(root, 'index.html')],
  ['/src/app.js', resolve(root, 'src/app.js')],
  ['/src/core.js', resolve(root, 'src/core.js')],
  ['/src/sample.js', resolve(root, 'src/sample.js')],
  ['/src/styles.css', resolve(root, 'src/styles.css')]
]);
const securityHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
};

function fail(message) {
  console.error(message);
  process.exit(2);
}

function requestedPort() {
  const argumentsList = process.argv.slice(2);
  let value = process.env.PORT;
  let source = 'PORT';
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--port') {
      value = argumentsList[index + 1];
      source = '--port';
      index += 1;
    } else if (argument.startsWith('--port=')) {
      value = argument.slice('--port='.length);
      source = '--port';
    } else fail(`Unknown option “${argument}”. Usage: node server.mjs [--port <number>]`);
  }
  if (value === undefined) return defaultPort;
  const port = /^\d+$/u.test(value.trim()) ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port > 65535) fail(`${source} must be a whole number from 0 to 65535, not “${value}”.`);
  return port;
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...headers });
  response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    // Only this machine's own addresses are served, which also defeats DNS rebinding.
    const { port } = server.address();
    if (![`${host}:${port}`, `localhost:${port}`].includes((request.headers.host ?? '').toLowerCase())) {
      send(response, 421, `Clipclean only answers requests for http://${host}:${port}`);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url ?? '/', `http://${host}`).pathname);
    const target = publicFiles.get(pathname);
    if (!target) {
      send(response, 404, 'Not found');
      return;
    }
    const body = await readFile(target);
    response.writeHead(200, { ...securityHeaders, 'Content-Type': types.get(extname(target)) ?? 'application/octet-stream', 'Content-Length': body.length });
    response.end(body);
  } catch (error) {
    const missing = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
    send(response, missing ? 404 : 400, missing ? 'Not found' : 'Invalid request');
  }
});

const port = requestedPort();
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Stop the other process or choose another port with --port <number>.`);
  else if (error.code === 'EACCES') console.error(`Permission denied for port ${port}. Choose a port above 1023 with --port <number>.`);
  else console.error(`Clipclean could not start: ${error.message}`);
  process.exit(1);
});
server.listen(port, host, () => {
  console.log(`Clipclean is available at http://${host}:${server.address().port}`);
});
const close = () => {
  server.close(() => process.exit(0));
  // Browsers keep connections alive; close them so shutting down does not wait for them to time out.
  server.closeAllConnections();
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
