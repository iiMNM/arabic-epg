# AIOLiveTV — استضافة ذاتية (Self-hosting)

نسخة خاصة فيك من إضافة Stremio **AIOLiveTV** بدل النسخة العامة على
`94c8cb9f702d-aiolivetv.baby-beamup.club`.
الإضافة مصدر مفتوح ([mrcanelas/aiolivetv](https://github.com/mrcanelas/aiolivetv)، رخصة AGPL-3.0)،
وهذا المجلد يشغّل صورتها الرسمية `ghcr.io/mrcanelas/aiolivetv` مع HTTPS تلقائي.

**ليش تستضيفها بنفسك؟** بيانات Xtream/M3U حقتك تبقى عندك، ما تتأثر لو النسخة العامة طاحت أو انضغطت،
وتقدر تقفلها بيوزر وباسورد.

## الطريقة 1: سيرفر VPS بأمر واحد (الأسهل)

أي VPS فيه Ubuntu/Debian (Hetzner، Oracle Cloud المجاني، Contabo…) ومنافذ 80 و 443 مفتوحة:

```sh
curl -fsSL https://raw.githubusercontent.com/iimnm/arabic-epg/main/aiolivetv/install.sh | sh
```

السكربت:
1. ينصّب Docker إذا مو موجود.
2. يسوي ملف `.env` فيه مفتاح تشفير عشوائي وباسورد، ودومين مجاني من **sslip.io** مبني على IP السيرفر
   (مثلاً `5-75-1-20.sslip.io`) — فما تحتاج تشتري دومين.
3. يشغّل الإضافة + Caddy اللي يطلع شهادة HTTPS لحاله.

بعدها افتح الرابط اللي يطبعه: `https://<IP>.sslip.io/stremio/configure`

## الطريقة 2: يدوياً

```sh
git clone https://github.com/iimnm/arabic-epg.git
cd arabic-epg/aiolivetv
cp .env.sample .env
nano .env          # عبّي DOMAIN و BASE_URL و SECRET_KEY و AIOLIVETV_AUTH
docker compose up -d
```

| المتغيّر | الوصف |
|---|---|
| `DOMAIN` | الدومين اللي يأشّر على السيرفر (أو `1-2-3-4.sslip.io`) |
| `BASE_URL` | نفس الدومين مع `https://` |
| `SECRET_KEY` | `openssl rand -hex 32` — **لا تغيّره أبداً** بعد أول تشغيل |
| `AIOLIVETV_AUTH` | `يوزر:باسورد` لصفحة الإعدادات |

عندك دومين خاص؟ أضف سجل `A` يأشّر على IP السيرفر وحطه في `DOMAIN`.
عندك Nginx/Traefik جاهز؟ احذف خدمة `caddy` من `compose.yaml` ووجّه الدومين على `127.0.0.1:3000`.

## نقل إعداداتك من النسخة العامة

1. افتح الإعدادات في النسخة القديمة (`.../stremio/configure`) وادخل بالـ UUID والباسورد حقك.
2. خذ **Backup** (ملف JSON).
3. في نسختك الجديدة: افتح `/stremio/configure` ← استورد الملف ← **Save & Install**.
4. احذف الإضافة القديمة من Stremio وركّب الجديدة من الرابط اللي يعطيك.

> إذا ما تتذكر الـ UUID والباسورد، أضف المصادر من جديد (Xtream / M3U / XMLTV). تقدر تستخدم دليل
> هذا المستودع كمصدر XMLTV: `https://raw.githubusercontent.com/iimnm/arabic-epg/output/guide.xml.gz`

## التحديث والنسخ الاحتياطي

```sh
cd ~/aiolivetv        # أو arabic-epg/aiolivetv
docker compose pull && docker compose up -d
```

كل الإعدادات في مجلد `data/` (قاعدة SQLite) — انسخه احتياطياً مع ملف `.env`.

## ملاحظات

- Stremio يحتاج **HTTPS** للإضافات اللي مو على نفس الجهاز، عشان كذا فيه Caddy.
- البث افتراضياً يروح من التطبيق للمزوّد مباشرة (Redirect)، فالسيرفر ما يستهلك باندويث كثير.
  لو مزوّدك محجوب عندك، فعّل البروكسي من صفحة **Settings** في لوحة الإدارة.
- **Vercel / Render المجاني** ممكن بس معقّد: لازم PostgreSQL و Redis خارجيين لأن الملفات تنمسح.
  التفاصيل في [دليل النشر الرسمي](https://mrcanelas.github.io/aiolivetv/getting-started/deployment).
