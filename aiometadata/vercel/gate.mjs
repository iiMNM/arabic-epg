// بوابة صغيرة قدّام AIOMetadata على Vercel.
// تشغّل Redis محلي (بدل Redis خارجي ينقطع أو يخلص حده المجاني)، بعدين الإضافة.
// السيرفر ينام لما ما أحد يستخدمه، وأول ما يصحى يرد 503 "still initializing" لين يجهز،
// و Stremio يعتبرها فشل ويعلق. البوابة تمسك الطلبات وتنتظر لين الإضافة تجهز، بعدين تمررها.
import http from 'node:http';
import { spawn } from 'node:child_process';

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

http.createServer(async (req, res) => {
  // فحوصات الصحة تمر مباشرة؛ الباقي ينتظر الجاهزية
  if (!req.url.startsWith('/health')) await whenReady();
  const up = http.request(
    { host: '127.0.0.1', port: APP_PORT, method: req.method, path: req.url, headers: req.headers },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); },
  );
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '2' });
    res.end('{"status":"starting"}');
  });
  req.pipe(up);
}).listen(PUBLIC_PORT, () => console.log(`[gate] listening on :${PUBLIC_PORT} -> :${APP_PORT}`));
