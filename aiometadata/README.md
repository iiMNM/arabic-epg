# AIOMetadata — استضافة ذاتية (Self-hosting)

نسخة خاصة فيك من إضافة Stremio **AIOMetadata** (بيانات الأفلام والمسلسلات والأنمي: بوسترات، وصف،
كتالوجات من TMDB و TVDB و MAL و AniList و IMDb…) بدل النسخة العامة على `aiometadata.viren070.me`.
الإضافة مصدر مفتوح ([cedya77/aiometadata](https://github.com/cedya77/aiometadata)، رخصة AGPL-3.0)،
وهذا المجلد يشغّل صورتها الرسمية `ghcr.io/cedya77/aiometadata` مع Redis و HTTPS تلقائي.

**ليش تستضيفها بنفسك؟** أسرع، ما تتأثر بالضغط أو لو النسخة العامة طاحت، ومفاتيحك وإعداداتك تبقى عندك.

## قبل لا تبدأ: مفتاح TMDB (مجاني وإجباري)

1. سوّ حساب في [themoviedb.org](https://www.themoviedb.org/signup).
2. روح [Settings ← API](https://www.themoviedb.org/settings/api) واطلب مفتاح (Developer).
3. انسخ **API Key** (الـ v3، القصير).

اختياري: [TVDB](https://thetvdb.com/api-information) (ينصح فيه للمسلسلات)، [Fanart.tv](https://fanart.tv/get-an-api-key/)، RPDB، MDBList.

## الطريقة 1: سيرفر VPS بأمر واحد (الأسهل)

أي VPS فيه Ubuntu/Debian (Hetzner، Oracle Cloud المجاني، Contabo…) ومنافذ 80 و 443 مفتوحة، وذاكرة 1GB أو أكثر:

```sh
curl -fsSL https://raw.githubusercontent.com/iimnm/arabic-epg/main/aiometadata/install.sh | sh
```

السكربت:
1. ينصّب Docker إذا مو موجود.
2. يسألك عن مفتاح TMDB (أو مرّره: `... | TMDB_KEY=xxxx sh`).
3. يسوي ملف `.env` فيه `ADMIN_KEY` وباسورد عشوائي، ودومين مجاني من **sslip.io** مبني على IP السيرفر
   (مثلاً `5-75-1-20.sslip.io`) — فما تحتاج تشتري دومين.
4. يشغّل الإضافة + Redis + Caddy اللي يطلع شهادة HTTPS لحاله.

بعدها افتح الرابط اللي يطبعه: `https://<IP>.sslip.io/configure`

## الطريقة 2: يدوياً

```sh
git clone https://github.com/iimnm/arabic-epg.git
cd arabic-epg/aiometadata
cp .env.sample .env
nano .env          # عبّي DOMAIN و HOST_NAME و ADMIN_KEY و BUILT_IN_TMDB_API_KEY
docker compose up -d
```

| المتغيّر | الوصف |
|---|---|
| `DOMAIN` | الدومين اللي يأشّر على السيرفر (أو `1-2-3-4.sslip.io`) |
| `HOST_NAME` | نفس الدومين مع `https://` — **ضروري** وإلا Stremio ما يلقى الإضافة |
| `ADMIN_KEY` | `openssl rand -hex 32` — يحمي لوحة التحكم |
| `ADDON_PASSWORD` | باسورد لصفحة الإعدادات (عشان محد يستخدم سيرفرك) |
| `BUILT_IN_TMDB_API_KEY` | مفتاح TMDB (إجباري) |
| `BUILT_IN_TVDB_API_KEY` وغيره | مفاتيح اختيارية |

> استخدمنا `BUILT_IN_*` بدل `TMDB_API_KEY` العادي لأن العادي **ينرسل كامل لأي زائر** عن طريق `/api/config`،
> أما `BUILT_IN_*` يبقى في السيرفر. كل المتغيّرات في [دليل المتغيّرات الرسمي](https://github.com/cedya77/aiometadata/blob/dev/docs/ENVIRONMENT_VARIABLES.md).

عندك دومين خاص؟ أضف سجل `A` يأشّر على IP السيرفر وحطه في `DOMAIN` و `HOST_NAME`.
عندك Nginx/Traefik جاهز؟ احذف خدمة `caddy` من `compose.yaml` ووجّه الدومين على `127.0.0.1:3232`.

## الطريقة 3: Vercel (بدون سيرفر)

الملفات في مجلد [`vercel/`](vercel): `Dockerfile.vercel` يبني من الصورة الرسمية ويشتغل كـ Container على Vercel.

1. سوّ مشروع جديد في Vercel، واربط فيه من **Storage** قاعدة **Neon** (Postgres).
   Redis 8 يشتغل **داخل الحاوية** (`gate.mjs`)، فما تحتاج Redis خارجي — Upstash المجاني ينقطع لما يخلص حده.
2. أضف المتغيّرات: `HOST_NAME=https://<مشروعك>.vercel.app` و `ADMIN_KEY` و `BUILT_IN_TMDB_API_KEY`،
   وأطفِ التسخين (كل نسخة لها كاشها):
   `ENABLE_CACHE_WARMING=false` و `CACHE_WARMUP_ON_STARTUP=false` و `TMDB_POPULAR_WARMING_ENABLED=false`
   و `MAL_WARMUP_ENABLED=false` و `CATALOG_REFRESH_AHEAD_ENABLED=false`.
3. من مجلد `vercel/`:  `npx vercel link`  ثم  `npx vercel deploy --prod`

> `DATABASE_URI` يتعبّى تلقائياً من `DATABASE_URL` اللي يعطيك Neon.

## التركيب في Stremio

1. افتح `https://<دومينك>/configure`.
2. اختر اللغة **العربية** (`ar`) للوصف والعناوين لو تبي، ورتّب الكتالوجات والمصادر.
3. اضغط **Install** (أو انسخ رابط `manifest.json` والصقه في بحث الإضافات في Stremio).
4. لو كنت مركّب النسخة العامة: احذفها من Stremio، وخلّ نسختك في **أعلى** قائمة الإضافات
   عشان تكون هي مصدر البيانات الأساسي (بدل Cinemeta).

> إعدادات النسخة العامة ما تنتقل تلقائياً — لو فيه خيار Export/Import في صفحة الإعدادات استخدمه، وإلا عيد ضبطها.

## التحديث والنسخ الاحتياطي

```sh
cd ~/aiometadata        # أو arabic-epg/aiometadata
docker compose pull && docker compose up -d
```

الإعدادات في مجلد `data/` (قاعدة SQLite) — انسخه احتياطياً مع ملف `.env`. مجلد `cache/` (Redis) ما يحتاج نسخ.

## ملاحظات

- Stremio يحتاج **HTTPS** للإضافات اللي مو على نفس الجهاز، عشان كذا فيه Caddy.
- أول تشغيل يكون أبطأ شوي لأنه يعبّي الكاش، بعدها يصير سريع.
- حالة السيرفر: `https://<دومينك>/health` — والسجلات: `docker compose logs -f aiometadata`.
- الرخصة AGPL: لو عدّلت الكود وشغّلته للناس لازم تنشر التعديل (`SOURCE_CODE_URL`). والاستخدام التجاري ممنوع
  بشروط TMDB و IMDb وغيرها — للاستخدام الشخصي بس.
