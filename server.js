// Tiny zero-dependency static file server for Lumen.
// Binds to 127.0.0.1 only, so nothing is exposed to your network.
// IMPORTANT: your data lives in the browser's storage for THIS exact origin
// (http://localhost:<port>). Always use the same port or the app will look empty.
import http from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeManifest } from './tools/build-precache.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const NO_CACHE = new Set(['/sw.js', '/index.html', '/precache-manifest.js', '/manifest.webmanifest']);

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  if (pathname.includes('\0')) return send(res, 400, 'Bad request');
  if (pathname.endsWith('/')) pathname += 'index.html';

  const target = resolve(join(PUBLIC, normalize(pathname)));
  if (target !== PUBLIC && !target.startsWith(PUBLIC + sep)) return send(res, 403, 'Forbidden');
  if (!existsSync(target)) return send(res, 404, 'Not found');

  let st;
  try { st = statSync(target); } catch { return send(res, 404, 'Not found'); }
  if (!st.isFile()) return send(res, 404, 'Not found');

  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
    ETag: etag,
    'Cache-Control': NO_CACHE.has(pathname) ? 'no-cache' : 'public, max-age=0, must-revalidate',
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
  if (pathname === '/sw.js') headers['Service-Worker-Allowed'] = '/';

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(target).on('error', () => res.destroy()).pipe(res);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use.`);
    console.error('If Lumen is already running, just open http://localhost:' + PORT);
    console.error('Otherwise stop the other program, or choose another port (note: data is stored per port,');
    console.error('so a different port starts with an empty database - use Export/Import to move data).');
    console.error('   PowerShell:  $env:PORT=5174; node server.js');
    console.error('   cmd.exe:     set PORT=5174 && node server.js\n');
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});

const info = writeManifest(PUBLIC);
server.listen(PORT, HOST, () => {
  console.log(`\nLumen is running:  http://localhost:${PORT}`);
  console.log(`Offline cache: ${info.count} files, version ${info.version}`);
  console.log('Press Ctrl+C to stop.\n');
});
