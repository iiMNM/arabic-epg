# AIOStreams — استضافة ذاتية على Vercel

نسخة خاصة من [AIOStreams](https://github.com/Viren070/AIOStreams) (AGPL-3.0) بدل `aiostreams.viren070.me`،
تشتغل كـ Container على Vercel من الصورة الرسمية `ghcr.io/viren070/aiostreams`.

- الرابط: `https://aiostreams-mnm.vercel.app/stremio/configure`
- قاعدة البيانات: Neon (Postgres) — `DATABASE_URI` يتعبّى من `DATABASE_URL` في `vercel/Dockerfile.vercel`
- بدون Redis (الكاش في الذاكرة، والإعدادات تتزامن بين النسخ عن طريق قاعدة البيانات)
- التحديث اليومي يسويه [`updater/`](../updater)

## المتغيّرات في Vercel

| المتغيّر | الوصف |
|---|---|
| `BASE_URL` | `https://aiostreams-mnm.vercel.app` |
| `SECRET_KEY` | `openssl rand -hex 32` — **لا يتغيّر أبداً** وإلا تضيع كل الإعدادات المحفوظة |
| `AIOSTREAMS_AUTH` | `يوزر:باسورد` — يقفل النسخة عشان محد يستخدمها غيرك |

باقي الإعدادات (الإضافات، الـ debrid، الفلاتر…) من صفحة الإعدادات أو لوحة التحكم.

## النشر يدوياً

```sh
cd aiostreams/vercel
npx vercel link        # اختر مشروع aiostreams-mnm
npx vercel deploy --prod
```
