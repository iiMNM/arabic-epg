// بوابة صغيرة قدّام AIOStreams على Vercel.
// 1) تمسك الطلبات وقت تشغيل الحاوية لين AIOStreams يجهز (بدل ما يفشل أول طلب بعد ما تنام).
// 2) تضيف هيدر كاش لـ CDN حق Vercel على الكتالوجات والـ meta وصور Jellyfin والملفات الثابتة،
//    عشان تنخدم من أقرب سيرفر للمستخدم بدون ما تصحّي الحاوية (أسرع، وأقل استهلاك للاشتراك).
//
// Vercel-CDN-Cache-Control is read by Vercel's CDN only, never by Stremio, Odin or browsers.
// Only URLs that carry the user's id in the path (Stremio routes) or need no login (artwork, static
// files) are cached; Jellyfin API answers are tied to a login header and always pass through.
import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';

const PUBLIC_PORT = Number(process.env.PORT || 80);
const APP_PORT = 3000;
const MAX_WAIT_MS = 45000;

const APP_ENTRY = process.env.GATE_APP_ENTRY || '/app/packages/server/dist/server.js';
const app = spawn(process.execPath, [APP_ENTRY], {
  stdio: 'inherit',
  cwd: process.env.GATE_APP_CWD || '/app',
  env: { ...process.env, PORT: String(APP_PORT) },
});
app.on('exit', (code, sig) => process.exit(code ?? (sig ? 1 : 0)));
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => app.kill(s));

let ready = false;
let waiting = null;
const probe = () => new Promise((resolve) => {
  const r = http.get({ host: '127.0.0.1', port: APP_PORT, path: '/api/v1/health', timeout: 3000 }, (res) => {
    res.resume();
    resolve(res.statusCode < 500);
  });
  r.on('error', () => resolve(false));
  r.on('timeout', () => { r.destroy(); resolve(false); });
});
function whenReady() {
  if (ready) return Promise.resolve(true);
  waiting ??= (async () => {
    const until = Date.now() + MAX_WAIT_MS;
    while (Date.now() < until) {
      if (await probe()) { ready = true; console.log('[gate] aiostreams ready'); return true; }
      await new Promise((r) => setTimeout(r, 250));
    }
    waiting = null;
    return false;
  })();
  return waiting;
}
whenReady();

// ---- Vercel CDN caching ----
const CDN = 'vercel-cdn-cache-control';
const TTL = {
  catalog: Number(process.env.CDN_CATALOG_TTL || 1800), // 30 min (served stale up to a day while it refreshes)
  meta: Number(process.env.CDN_META_TTL || 21600),      // 6 hours
  image: Number(process.env.CDN_IMAGE_TTL || 86400),    // artwork redirects/relays: 1 day
};
const STREMIO_JSON = /^\/stremio\/[^/]+\/[^/]+\/(catalog|meta)\/[^?]+\.json$/;
const ARTWORK = /\/(Items|Persons|Genres|Studios|MusicGenres|Artists)\/[^/]+\/Images\//i;
const STATIC = /^\/(assets|jellyfin-web\/static)\//;

function worthCaching(kind, body) {
  try {
    const j = JSON.parse(body);
    if (kind === 'catalog') return Array.isArray(j.metas) && j.metas.length > 0;
    if (kind === 'meta') return !!(j.meta && j.meta.id);
  } catch {}
  return false;
}

function forward(req, res, onResponse) {
  const up = http.request(
    { host: '127.0.0.1', port: APP_PORT, method: req.method, path: req.url, headers: req.headers },
    onResponse,
  );
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '2' });
    res.end('{"status":"starting"}');
  });
  req.pipe(up);
}

const server = http.createServer(async (req, res) => {
  await whenReady();
  const path = req.url.split('?')[0];
  const json = req.method === 'GET' && path.match(STREMIO_JSON);

  if (json) {
    const kind = json[1];
    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    delete req.headers['accept-encoding'];
    return forward(req, res, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        let body = Buffer.concat(chunks);
        const headers = { ...r.headers };
        delete headers['content-length'];
        delete headers['transfer-encoding'];
        if (r.statusCode === 200 && worthCaching(kind, body.toString('utf8'))) {
          headers[CDN] = `max-age=${TTL[kind]}, stale-while-revalidate=${kind === 'catalog' ? 86400 : 604800}, stale-if-error=86400`;
          delete headers['set-cookie'];
        }
        if (acceptsGzip && body.length > 1024) {
          body = zlib.gzipSync(body);
          headers['content-encoding'] = 'gzip';
          headers.vary = 'Accept-Encoding';
        }
        headers['content-length'] = String(body.length);
        res.writeHead(r.statusCode, headers);
        res.end(body);
      });
    });
  }

  forward(req, res, (r) => {
    const headers = { ...r.headers };
    const cc = String(headers['cache-control'] || '');
    if ((req.method === 'GET' || req.method === 'HEAD') && !/no-store|private/.test(cc)) {
      if (ARTWORK.test(path) && [200, 302].includes(r.statusCode)) headers[CDN] = `max-age=${TTL.image}, stale-while-revalidate=604800`;
      else if (STATIC.test(path) && r.statusCode === 200 && /immutable/.test(cc)) headers[CDN] = 'max-age=31536000, immutable';
      if (headers[CDN]) delete headers['set-cookie'];
    }
    res.writeHead(r.statusCode, headers);
    r.pipe(res);
  });
});

// WebSockets (Jellyfin sessions, SyncPlay) go straight through.
server.on('upgrade', async (req, socket, head) => {
  await whenReady();
  const up = net.connect(APP_PORT, '127.0.0.1', () => {
    up.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
      Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
    if (head && head.length) up.write(head);
    up.pipe(socket).pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.keepAliveTimeout = 65000;
server.listen(PUBLIC_PORT, () => console.log(`[gate] listening on :${PUBLIC_PORT} -> :${APP_PORT}`));
