# addons-updater — تحديث يومي تلقائي لإضافات Stremio على Vercel

مشروع Vercel صغير فيه دالة وحدة (`api/update.mjs`) يشغّلها **Vercel Cron** كل يوم الساعة 03:41 UTC:

| الإضافة | مصدر آخر إصدار | طريقة النشر |
|---|---|---|
| AIOMetadata (`aiometadata-mnm`) | آخر tag مستقر للصورة على `ghcr.io/cedya77/aiometadata` | Dockerfile صغير يبني من الصورة |
| AIOLiveTV (`aiolivetv-mnm`) | آخر tag `vX.Y.Z` في `mrcanelas/aiolivetv` | يحمّل كود الإصدار ويرفعه لـ Vercel |

الإصدار المنشور يتسجّل في `meta.upstreamVersion` حق الـ deployment، فما يحتاج يعدّل المستودع.
لو الإصدار الجديد ما انبنى، Vercel يخلي النسخة القديمة شغّالة.

## المتغيّرات

| المتغيّر | الوصف |
|---|---|
| `VERCEL_TOKEN` | مفتاح من vercel.com/account/tokens (عشان ينشر) |
| `CRON_SECRET` | Vercel يرسله مع طلبات الـ Cron؛ أي طلب بدونه ينرفض |

## تشغيل يدوي

```sh
curl -H "Authorization: Bearer $CRON_SECRET" "https://addons-updater.vercel.app/api/update?dry=1"   # يشيك بس
curl -H "Authorization: Bearer $CRON_SECRET" "https://addons-updater.vercel.app/api/update?force=aiometadata"
```

النتائج تطلع في **Logs** حق المشروع في Vercel.
