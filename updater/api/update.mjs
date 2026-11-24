// addons-updater: يشيك كل يوم على آخر إصدار رسمي لـ AIOMetadata المنشورة على Vercel
// ولو نزل إصدار جديد ينشره عن طريق Vercel API. يشتغل من Vercel Cron.
//   GET /api/update            (Authorization: Bearer $CRON_SECRET)
//   ?dry=1                     يشيك بس بدون نشر
//   ?force=aiometadata         ينشر حتى لو ما فيه تحديث
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
      return [
        { file: 'Dockerfile.vercel', data: dockerfile, encoding: 'utf-8' },
        { file: 'vercel.json', data: vercelJson, encoding: 'utf-8' },
      ];
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
  return { ...res, action: 'deploying', deployment: dep.id, url: dep.url };
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
