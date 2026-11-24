# Xtream Bridge — تحويل قائمة M3U + EPG إلى سيرفر Xtream

سيرفر صغير يقرأ قائمتك (حتى لو في مستودع **خاص**) ويطلعها بصيغة Xtream Codes
(سيرفر + يوزر + باسورد) مع دليل البرامج my-epg. يشتغل على **Vercel** (مجاني) أو Deno Deploy أو Render.

القائمة ما تنكشف لأحد: السيرفر يسحبها بتوكن سري محفوظ في إعدادات الموقع، وكل طلب يحتاج اليوزر والباسورد.

## 1) توكن GitHub يقرأ مستودع MNM الخاص

1. GitHub ← Settings ← Developer settings ← **Fine-grained tokens** ← Generate new token
2. Repository access: **Only select repositories** ← `iiMNM/MNM`
3. Permissions ← Repository ← **Contents: Read-only**
4. انسخ التوكن (يبدأ بـ `github_pat_`)

رابط القائمة يكون بهالشكل (قائمة MNM):
```
https://raw.githubusercontent.com/iiMNM/MNM/main/MNM.m3u
```

## 2) النشر على Vercel (الأسهل)

1. ادخل [vercel.com](https://vercel.com) وسجّل بحساب GitHub
2. **Add New → Project** ← اختر مستودع `arabic-epg` (أو أي مستودع فيه مجلد `xtream`)
3. **Root Directory** ← `xtream`
4. **Environment Variables**:

| الاسم | القيمة |
|---|---|
| `M3U_URL` | رابط القائمة من الخطوة 1 |
| `GITHUB_TOKEN` | التوكن |
| `XT_USER` | اليوزر اللي تبيه |
| `XT_PASS` | الباسورد اللي تبيه |
| `EPG_URL` | (اختياري) الافتراضي `https://raw.githubusercontent.com/iimnm/my-epg/epg/epg.xml.gz` |

5. **Deploy** ← بيعطيك رابط مثل `https://mnm-xtream.vercel.app`

## 3) في التطبيق (TiviMate / IPTV Smarters / OTT Navigator)

اختر **Xtream Codes** وحط:
- **Server:** `https://mnm-xtream.vercel.app`
- **Username / Password:** اللي حطيتهم في `XT_USER` و `XT_PASS`

أو رابط M3U جاهز:
```
https://mnm-xtream.vercel.app/get.php?username=USER&password=PASS&type=m3u_plus
```
والـ EPG: `https://mnm-xtream.vercel.app/xmltv.php?username=USER&password=PASS`

## بدائل Vercel

- **Deno Deploy** ([dash.deno.com](https://dash.deno.com)): New Project ← اختر المستودع ← Entrypoint: `xtream/main.ts` ← نفس المتغيرات.
- **Render / Koyeb / Railway**: Web Service ← Root `xtream` ← Start command `node server.js` ← نفس المتغيرات.
  (خطة Render المجانية تنام بعد 15 دقيقة، وأول فتح ياخذ ثواني.)

## ملاحظات

- البث نفسه ما يمر من السيرفر: السيرفر يحوّل التطبيق لرابط القناة الأصلي، فما يستهلك باندويث.
- القائمة تتحدّث تلقائياً كل 10 دقائق (`CACHE_SECONDS`). عدّل ملف الـ m3u في GitHub وخلاص.
- رقم كل قناة ثابت (مبني على الاسم والمجموعة)، فالمفضلة ما تضيع لو رتّبت القائمة.
- القنوات اللي تحتاج User-Agent خاص (`#EXTVLCOPT`) ممكن ما تشتغل لأن التحويل ما ينقل الهيدرز.
