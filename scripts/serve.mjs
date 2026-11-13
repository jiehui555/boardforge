import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import process from 'node:process';

const root = resolve(process.argv[2] || process.cwd());
const port = Number(process.env.PORT || process.argv[3] || 4173);
const host = process.env.HOST || '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
      send(response, 405, 'Method Not Allowed');
      return;
    }

    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    const filePath = resolve(root, `.${pathname}`);
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      send(response, 403, 'Forbidden');
      return;
    }

    let target = filePath;
    try {
      const info = await stat(target);
      if (info.isDirectory()) target = resolve(target, 'index.html');
    } catch {
      send(response, 404, 'Not Found');
      return;
    }

    const body = await readFile(target);
    const type = MIME_TYPES[extname(target).toLowerCase()] || 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') response.end();
    else response.end(body);
  } catch (error) {
    console.error(error);
    send(response, 500, 'Internal Server Error');
  }
});

server.listen(port, host, () => {
  console.log(`BoardForge dev server: http://${host}:${port}/`);
  console.log(`Serving: ${root}`);
});
