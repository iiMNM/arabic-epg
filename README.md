# Arabic EPG — دليل البرامج للقنوات العربية

دليل برامج (EPG) بصيغة **XMLTV** لجميع القنوات العربية (رياضة، أخبار، أفلام، أطفال، دينية، منوعات…)،
مبني على [iptv-org/epg](https://github.com/iptv-org/epg) ويتحدّث تلقائياً كل يوم عبر GitHub Actions.

## روابط الدليل

| الملف | الرابط |
|---|---|
| الدليل (XML) | `https://raw.githubusercontent.com/iimnm/arabic-epg/output/guide.xml` |
| الدليل مضغوط (GZ) | `https://raw.githubusercontent.com/iimnm/arabic-epg/output/guide.xml.gz` |
| قائمة tvg-id لكل القنوات | [channels.txt](channels.txt) |
| إحصائيات القنوات والمصادر | [STATS.md](https://github.com/iimnm/arabic-epg/blob/output/STATS.md) |

ضع أحد الروابط في خانة EPG / XMLTV في تطبيقك (TiviMate، IPTV Smarters، Kodi، OTT Navigator…).
معرّفات القنوات (`tvg-id`) هي نفس معرّفات [iptv-org](https://github.com/iptv-org/iptv) مثل `MBC1.ae@SD` و `beINSports1.qa@SD`.

## كيف يشتغل

1. **`scripts/build_channels.py`** يمر على كل ملفات `sites/*/*.channels.xml` في iptv-org/epg ويختار أي قناة:
   - بلدها عضو في جامعة الدول العربية (22 دولة)، **أو**
   - إحدى بثوثها باللغة العربية (حسب [iptv-org/database](https://github.com/iptv-org/database))، **أو**
   - مصدرها موسوم `lang="ar"`.
2. يقسّم القائمة على 12 مهمة متوازية (كل موقع كامل في مهمة واحدة) وتشغّل كل مهمة `npm run grab`.
3. **`scripts/merge_guides.py`** يدمج النتائج: إذا القناة موجودة في أكثر من موقع، ياخذ المصدر اللي فيه
   أكثر برامج (ويفضّل العربي عند التساوي)، ويطلع `guide.xml` و `guide.xml.gz`.
4. الملفات تنرفع على فرع **`output`** (يُستبدل كل مرة عشان المستودع يبقى خفيف).

## التشغيل اليدوي

من تبويب **Actions** ← **Update Arabic EPG** ← **Run workflow** (تقدر تحدد عدد الأيام، الافتراضي 3).

## استبعاد موقع

إذا فيه موقع معطّل أو بطيء، أضف اسمه في `excluded_sites.txt` (سطر لكل موقع).

## التشغيل محلياً

```sh
git clone --depth 1 https://github.com/iptv-org/epg.git
git clone --depth 1 https://github.com/iptv-org/database.git
python3 scripts/build_channels.py --epg epg --db database --out arabic.channels.xml
cd epg && npm ci
npm run grab --- --channels=../arabic.channels.xml --output=../guides/{site}.xml --maxConnections=5 --days=3
cd .. && python3 scripts/merge_guides.py --out guide.xml --gzip guides/*.xml
```
