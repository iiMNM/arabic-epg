// بوابة صغيرة قدّام AIOMetadata على Vercel.
// تشغّل Redis محلي (بدل Redis خارجي ينقطع أو يخلص حده المجاني)، بعدين الإضافة.
// وتضيف هيدر كاش لـ CDN حق Vercel على البوسترات والكتالوجات والـ meta، عشان تنخدم من أقرب سيرفر بدون ما تصحّي الحاوية.
// السيرفر ينام لما ما أحد يستخدمه، وأول ما يصحى يرد 503 "still initializing" لين يجهز،
// و Stremio يعتبرها فشل ويعلق. البوابة تمسك الطلبات وتنتظر لين الإضافة تجهز، بعدين تمررها.
import http from 'node:http';
import { spawn } from 'node:child_process';
import zlib from 'node:zlib';

const PUBLIC_PORT = Number(process.env.PORT || 80);
const APP_PORT = 3232;
const MAX_WAIT_MS = 45000;

const redis = spawn('redis-server', [
  '--bind', '127.0.0.1', '--port', '6379', '--save', '', '--appendonly', 'no',
  '--maxmemory', process.env.LOCAL_REDIS_MAXMEMORY || '384mb', '--maxmemory-policy', 'allkeys-lfu',
], { stdio: 'inherit' });
redis.on('exit', (code) => { console.error(`[gate] redis exited (${code})`); process.exit(1); });

const app = spawn('node', ['dist/server/server.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: String(APP_PORT),
    REDIS_URL: 'redis://127.0.0.1:6379',
    REDIS_AUTOTUNE: 'false',
    // كل نسخة لها كاش؛ الإعدادات تتحدّث من Postgres خلال دقيقة
    CONFIG_CACHE_TTL_SEC: process.env.CONFIG_CACHE_TTL_SEC || '60',
  },
});
app.on('exit', (code, sig) => { redis.kill('SIGTERM'); process.exit(code ?? (sig ? 1 : 0)); });
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { app.kill(s); redis.kill(s); });

let ready = false;
let waiting = null;
const probe = () => new Promise((resolve) => {
  const r = http.get({ host: '127.0.0.1', port: APP_PORT, path: '/health/ready', timeout: 3000 }, (res) => {
    let b = '';
    res.on('data', (c) => (b += c));
    res.on('end', () => resolve(res.statusCode === 200 && /"ready":\s*true/.test(b)));
  });
  r.on('error', () => resolve(false));
  r.on('timeout', () => { r.destroy(); resolve(false); });
});
function whenReady() {
  if (ready) return Promise.resolve(true);
  waiting ??= (async () => {
    const until = Date.now() + MAX_WAIT_MS;
    while (Date.now() < until) {
      if (await probe()) { ready = true; console.log('[gate] addon ready'); return true; }
      await new Promise((r) => setTimeout(r, 250));
    }
    waiting = null;
    return false;
  })();
  return waiting;
}
whenReady();

// ---- Vercel CDN caching ----
// AIOMetadata sends posters with "public, max-age" only and catalogs/meta with "no-cache", and Vercel's CDN
// caches nothing without a CDN-specific header, so every poster and catalog woke the container
// (slow from Saudi to iad1, and billed CPU/memory). Vercel-CDN-Cache-Control is read by Vercel's CDN only
// (never by Stremio or browsers), so repeats are served from the edge without touching the container.
// Personal URLs carry the user's config id in the path, so each user keeps their own cached copy.
const CDN = 'Vercel-CDN-Cache-Control';
const IMAGE = /^\/(poster|poster-cache\/proxy|api\/image)\//;
const STATIC = /^\/(assets|configure\/assets)\//;
const CATALOG = /\/catalog\/[^?]+\.json/;
const META = /\/meta\/[^?]+\.json/;
const TTL = {
  image: Number(process.env.CDN_IMAGE_TTL || 604800),     // 7 days
  catalog: Number(process.env.CDN_CATALOG_TTL || 1800),   // 30 min, served stale up to a day while it refreshes
  meta: Number(process.env.CDN_META_TTL || 21600),        // 6 hours
};

function jsonKind(req) {
  if (req.method !== 'GET') return null;
  const path = req.url.split('?')[0];
  if (path.includes('/manifest.json') || /\/(api|dashboard|configure)\//.test(path)) return null;
  if (CATALOG.test(req.url)) return 'catalog';
  if (META.test(req.url)) return 'meta';
  return null;
}

// Only answers worth keeping: no errors, no empty catalogs, no missing meta.
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

http.createServer(async (req, res) => {
  // فحوصات الصحة تمر مباشرة؛ الباقي ينتظر الجاهزية
  if (!req.url.startsWith('/health')) await whenReady();
  const path = req.url.split('?')[0];
  const kind = jsonKind(req);

  if (kind) {
    // catalogs/meta: read the (uncompressed) answer, cache it at the CDN only if it is a real result
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
          const ttl = TTL[kind];
          headers[CDN.toLowerCase()] = `max-age=${ttl}, stale-while-revalidate=${kind === 'catalog' ? 86400 : 604800}, stale-if-error=86400`;
          delete headers['set-cookie'];
        }
        if (acceptsGzip && body.length > 1024) {
          body = zlib.gzipSync(body);
          headers['content-encoding'] = 'gzip';
          headers.vary = 'Accept-Encoding';
        }
        headers['content-length'] = String(body.length);
        res.writeHead(r.statusCode, headers);
        res.end(req.method === 'HEAD' ? undefined : body);
      });
    });
  }

  forward(req, res, (r) => {
    const headers = { ...r.headers };
    const cc = String(headers['cache-control'] || '');
    if ((req.method === 'GET' || req.method === 'HEAD') && !/no-store|private/.test(cc)) {
      if (IMAGE.test(path) && r.statusCode === 200) headers[CDN.toLowerCase()] = `max-age=${TTL.image}, stale-while-revalidate=2592000, stale-if-error=604800`;
      else if (IMAGE.test(path) && [301, 302, 307, 308].includes(r.statusCode)) headers[CDN.toLowerCase()] = 'max-age=3600'; // a redirect can be the fallback after an upstream error: keep it short
      else if (STATIC.test(path) && r.statusCode === 200 && /immutable/.test(cc)) headers[CDN.toLowerCase()] = 'max-age=31536000, immutable';
      if (headers[CDN.toLowerCase()]) delete headers['set-cookie'];
    }
    res.writeHead(r.statusCode, headers);
    r.pipe(res);
  });
}).listen(PUBLIC_PORT, () => console.log(`[gate] listening on :${PUBLIC_PORT} -> :${APP_PORT}`));
