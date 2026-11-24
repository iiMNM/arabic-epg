// addons-updater: يشيك كل يوم على آخر إصدار رسمي لإضافات Stremio المنشورة على Vercel
// ولو نزل إصدار جديد ينشره عن طريق Vercel API. يشتغل من Vercel Cron.
//   GET /api/update            (Authorization: Bearer $CRON_SECRET)
//   ?dry=1                     يشيك بس بدون نشر
//   ?force=aiometadata|aiolivetv  ينشر حتى لو ما فيه تحديث
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const API = 'https://api.vercel.com';
const TEAM = process.env.VERCEL_TEAM_ID || 'team_T2xc2y0dggmF8PtqYSI4NdB7';
const TOKEN = process.env.VERCEL_TOKEN;
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

const cmp = (a, b) => {
  const x = a.match(SEMVER).slice(1).map(Number), y = b.match(SEMVER).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
const newest = (tags) => tags.filter((t) => SEMVER.test(t)).sort(cmp).pop()?.replace(/^v/, '');

async function vercel(path, init = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${API}${path}${sep}teamId=${TEAM}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(body.error || body).slice(0, 300)}`);
  return body;
}

// ---------- tar.gz → files ----------
function untar(buf) {
  const out = [];
  let off = 0, longName = null, paxPath = null;
  const str = (b, s, l) => b.subarray(s, s + l).toString('utf8').replace(/\0.*$/s, '');
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((c) => c === 0)) break;
    const size = parseInt(str(h, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const mode = parseInt(str(h, 100, 8).trim() || '644', 8);
    const prefix = str(h, 345, 155);
    let name = longName || paxPath || (prefix ? `${prefix}/${str(h, 0, 100)}` : str(h, 0, 100));
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = data.toString('utf8').replace(/\0.*$/s, ''); continue; }
    if (type === 'x') { const m = data.toString('utf8').match(/\d+ path=([^\n]*)\n/); paxPath = m ? m[1] : null; continue; }
    if (type === 'g') continue;
    longName = paxPath = null;
    if (type !== '0') continue; // ملفات عادية بس
    name = name.split('/').slice(1).join('/'); // نشيل مجلد الـ tarball الأعلى
    if (name) out.push({ file: name, data: Buffer.from(data), mode });
  }
  return out;
}

async function uploadFiles(files) {
  const list = [];
  let i = 0;
  const worker = async () => {
    while (i < files.length) {
      const f = files[i++];
      const sha = createHash('sha1').update(f.data).digest('hex');
      await vercel('/v2/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'x-vercel-digest': sha, 'Content-Length': String(f.data.length) },
        body: f.data,
      });
      list.push({ file: f.file, sha, size: f.data.length, mode: f.mode | 0o100000 });
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  return list;
}

// ---------- الإضافات ----------
const ADDONS = {
  aiometadata: {
    project: 'prj_Uiv3DkX5QiK0hZzXk0vswTBob3mE',
    name: 'aiometadata-mnm',
    url: 'https://aiometadata-mnm.vercel.app',
    async latest() {
      // آخر إصدار مستقر منشور كصورة على GHCR (مو كل tag في git له صورة)
      const { token } = await (await fetch('https://ghcr.io/token?scope=repository:cedya77/aiometadata:pull')).json();
      const r = await fetch('https://ghcr.io/v2/cedya77/aiometadata/tags/list?n=10000', { headers: { Authorization: `Bearer ${token}` } });
      return newest((await r.json()).tags || []);
    },
    async fallbackCurrent() {
      return (await (await fetch(`${this.url}/health`)).json()).version;
    },
    async files(v) {
      const dockerfile = [
        '# AIOMetadata على Vercel (Container) — منشور من addons-updater',
        `FROM ghcr.io/cedya77/aiometadata:${v}`,
        'ENV NODE_ENV=production \\',
        '    TZ=Asia/Riyadh \\',
        '    PORT=80',
        'EXPOSE 80',
        'ENTRYPOINT ["/bin/sh", "-c", "export DATABASE_URI=\\"${DATABASE_URI:-$DATABASE_URL}\\"; exec node dist/server/server.js"]',
        '',
      ].join('\n');
      const vercelJson = JSON.stringify({
        git: { deploymentEnabled: false },
        services: { addon: { root: '.', entrypoint: 'Dockerfile.vercel', runtime: 'container' } },
        rewrites: [{ source: '/(.*)', destination: { service: 'addon' } }],
      }, null, 2);
      return uploadFiles([
        { file: 'Dockerfile.vercel', data: Buffer.from(dockerfile), mode: 0o644 },
        { file: 'vercel.json', data: Buffer.from(vercelJson), mode: 0o644 },
      ]);
    },
  },
  aiolivetv: {
    project: 'prj_fcsswgCKy2kf8VCOpp4Wivo18Zxe',
    name: 'aiolivetv-mnm',
    async latest() {
      const r = await fetch('https://api.github.com/repos/mrcanelas/aiolivetv/tags?per_page=100', {
        headers: { 'User-Agent': 'addons-updater', Accept: 'application/vnd.github+json' },
      });
      return newest((await r.json()).map((t) => t.name));
    },
    async fallbackCurrent(dep) {
      return dep?.meta?.githubCommitMessage?.match(/release (\d+\.\d+\.\d+)/)?.[1];
    },
    async files(v) {
      const r = await fetch(`https://codeload.github.com/mrcanelas/aiolivetv/tar.gz/refs/tags/v${v}`);
      if (!r.ok) throw new Error(`tarball ${r.status}`);
      return uploadFiles(untar(gunzipSync(Buffer.from(await r.arrayBuffer()))));
    },
  },
};

async function current(addon) {
  const { deployments } = await vercel(`/v6/deployments?projectId=${addon.project}&target=production&state=READY&limit=1`);
  const dep = deployments?.[0];
  return dep?.meta?.upstreamVersion || (await addon.fallbackCurrent(dep));
}

async function check(key, { dry, force }) {
  const addon = ADDONS[key];
  const [now, latest] = await Promise.all([current(addon), addon.latest()]);
  const res = { addon: key, current: now, latest };
  if (!latest) throw new Error('could not read latest version');
  const outdated = !now || !SEMVER.test(now) || cmp(latest, now) > 0;
  if (!outdated && force !== key) return { ...res, action: 'up-to-date' };
  if (dry) return { ...res, action: 'would-deploy' };
  const files = await addon.files(latest);
  const dep = await vercel('/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: addon.name,
      project: addon.project,
      target: 'production',
      files,
      meta: { upstreamVersion: latest, deployedBy: 'addons-updater' },
    }),
  });
  return { ...res, action: 'deploying', deployment: dep.id, url: dep.url, files: files.length };
}

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!TOKEN) return res.status(500).json({ error: 'VERCEL_TOKEN is not set' });
  const opts = { dry: req.query.dry === '1', force: req.query.force };
  const results = [];
  for (const key of Object.keys(ADDONS)) {
    try { results.push(await check(key, opts)); }
    catch (e) { results.push({ addon: key, error: String(e.message || e) }); }
  }
  console.log(JSON.stringify(results));
  res.status(results.some((r) => r.error) ? 500 : 200).json(results);
}
