// addons-updater: يشيك كل يوم على آخر إصدار رسمي للإضافات المنشورة على Vercel
// (AIOMetadata و AIOStreams)، ولو نزل إصدار جديد ينشره عن طريق Vercel API. يشتغل من Vercel Cron.
//   GET /api/update                      (Authorization: Bearer $CRON_SECRET)
//   ?dry=1                               يشيك بس بدون نشر
//   ?force=aiometadata|aiostreams        ينشر حتى لو ما فيه تحديث
// ملفات النشر تنقرى من المستودع (<dir>/Dockerfile.vercel ...) ويتغيّر فيها رقم الإصدار بس.

const API = 'https://api.vercel.com';
const TEAM = process.env.VERCEL_TEAM_ID || 'team_T2xc2y0dggmF8PtqYSI4NdB7';
const TOKEN = process.env.VERCEL_TOKEN;
const RAW = 'https://raw.githubusercontent.com/iimnm/arabic-epg/main/';
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

const cmp = (a, b) => {
  const x = a.match(SEMVER).slice(1).map(Number), y = b.match(SEMVER).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

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

// آخر tag مستقر (X.Y.Z أو vX.Y.Z) منشور كصورة على GHCR — مع التنقل بين الصفحات
async function latestImageTag(image) {
  const { token } = await (await fetch(`https://ghcr.io/token?scope=repository:${image}:pull`)).json();
  let url = `https://ghcr.io/v2/${image}/tags/list?n=1000`;
  const tags = [];
  for (let page = 0; url && page < 50; page++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`ghcr ${image}: ${r.status}`);
    tags.push(...((await r.json()).tags || []));
    const next = r.headers.get('link')?.match(/<([^>]+)>/)?.[1];
    url = next ? new URL(next, 'https://ghcr.io').toString() : null;
  }
  return tags.filter((t) => SEMVER.test(t)).sort(cmp).pop();
}

const ADDONS = {
  aiometadata: {
    project: 'prj_Uiv3DkX5QiK0hZzXk0vswTBob3mE',
    name: 'aiometadata-mnm',
    image: 'cedya77/aiometadata',
    dir: 'aiometadata/vercel/',
    files: ['Dockerfile.vercel', 'gate.mjs', 'vercel.json'],
    async fallbackCurrent() {
      return (await (await fetch('https://aiometadata-mnm.vercel.app/health')).json()).version;
    },
  },
  aiostreams: {
    project: 'prj_8LjP7ByrZy4nMhOVHpwVw48y1etj',
    name: 'aiostreams-mnm',
    image: 'viren070/aiostreams',
    dir: 'aiostreams/vercel/',
    files: ['Dockerfile.vercel', 'gate.mjs', 'vercel.json'],
    async fallbackCurrent() {
      return (await (await fetch('https://aiostreams-mnm.vercel.app/api/v1/status')).json()).data?.tag;
    },
  },
};

async function current(addon) {
  const { deployments } = await vercel(`/v6/deployments?projectId=${addon.project}&target=production&state=READY&limit=1`);
  return deployments?.[0]?.meta?.upstreamVersion || (await addon.fallbackCurrent());
}

async function buildFiles(addon, tag) {
  const from = new RegExp(`^FROM ghcr\\.io/${addon.image.replace('/', '\\/')}:.*$`, 'm');
  return Promise.all(addon.files.map(async (f) => {
    const r = await fetch(RAW + addon.dir + f);
    if (!r.ok) throw new Error(`${addon.dir}${f}: ${r.status}`);
    let data = await r.text();
    if (f === 'Dockerfile.vercel') {
      if (!from.test(data)) throw new Error(`unexpected ${addon.dir}${f}`);
      data = data.replace(from, `FROM ghcr.io/${addon.image}:${tag}`);
    }
    return { file: f, data, encoding: 'utf-8' };
  }));
}

async function check(key, { dry, force }) {
  const addon = ADDONS[key];
  const [now, latest] = await Promise.all([current(addon), latestImageTag(addon.image)]);
  const res = { addon: key, current: now, latest };
  if (!latest) throw new Error('could not read latest version');
  const outdated = !now || !SEMVER.test(now) || cmp(latest, now) > 0;
  if (!outdated && force !== key) return { ...res, action: 'up-to-date' };
  if (dry) return { ...res, action: 'would-deploy' };
  const dep = await vercel('/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: addon.name,
      project: addon.project,
      target: 'production',
      files: await buildFiles(addon, latest),
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
  const results = await Promise.all(Object.keys(ADDONS).map((key) =>
    check(key, opts).catch((e) => ({ addon: key, error: String(e.message || e) }))));
  console.log(JSON.stringify(results));
  res.status(results.some((r) => r.error) ? 500 : 200).json(results);
}
