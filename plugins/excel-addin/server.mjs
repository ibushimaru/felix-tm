/**
 * Dev HTTPS server for the Felix TM Excel add-in.
 *
 * Office add-ins must load over HTTPS (Excel on the web embeds the task
 * pane in an iframe inside an https page, so plain http would be blocked
 * as mixed content). Certificates come from office-addin-dev-certs —
 * run `npx office-addin-dev-certs install` once; it generates a localhost
 * cert under ~/.office-addin-dev-certs and registers the CA in the
 * macOS keychain so browsers trust it.
 *
 * felix-engine.js and db.js are served straight out of
 * ../chrome-extension/ — that directory stays the single source of
 * truth for the shared engine (the Chrome extension must physically
 * contain its files, so the alias points here rather than the other
 * way around). Edits to the engine take effect on a pane reload with
 * no copy step.
 */
import https from 'node:https';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(ROOT, '..', 'chrome-extension');
const PORT = 3000;

const CERT_DIR = path.join(os.homedir(), '.office-addin-dev-certs');
const CERT = path.join(CERT_DIR, 'localhost.crt');
const KEY = path.join(CERT_DIR, 'localhost.key');
if (!existsSync(CERT) || !existsSync(KEY)) {
  console.error('HTTPS dev certificates not found.');
  console.error('Run once:  npx office-addin-dev-certs install');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8',
};

// URL path → file on disk. Shared engine/db/icons resolve into the
// chrome-extension directory; everything else serves from this one.
function resolvePath(urlPath) {
  if (urlPath === '/' || urlPath === '') urlPath = '/taskpane.html';
  if (urlPath === '/felix-engine.js') return path.join(EXT, 'felix-engine.js');
  if (urlPath === '/db.js') return path.join(EXT, 'db.js');
  if (urlPath.startsWith('/icons/')) {
    const p = path.normalize(path.join(EXT, urlPath));
    return p.startsWith(path.join(EXT, 'icons')) ? p : null;
  }
  const p = path.normalize(path.join(ROOT, urlPath));
  return p.startsWith(ROOT) ? p : null;
}

async function handler(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'https://localhost').pathname);
  const filePath = resolvePath(urlPath);
  if (!filePath) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      // Never cache during development — the whole point of the dev
      // server is that a pane reload picks up the latest source.
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

https.createServer({ cert: readFileSync(CERT), key: readFileSync(KEY) }, handler)
  .listen(PORT, () => {
    console.log(`Felix TM add-in dev server: https://localhost:${PORT}/taskpane.html`);
    console.log(`Serving ${ROOT}`);
    console.log(`Shared engine from ${EXT}`);
  });

// Plain-HTTP listener for browser-based UI development (the task pane
// works outside Excel minus selection tracking). Office itself must use
// the https listener above.
const HTTP_PORT = PORT + 1;
http.createServer(handler).listen(HTTP_PORT, () => {
  console.log(`Browser preview (no Office host): http://localhost:${HTTP_PORT}/taskpane.html`);
});
