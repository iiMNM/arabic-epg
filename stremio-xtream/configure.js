// The /configure page (Arabic, RTL). Kept as a JS string so every platform can serve it without file access.
export const CONFIGURE_HTML = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Xtream IPTV لـ Stremio</title>
<link rel="icon" href="/logo.svg">
<style>
  :root { --bg:#f5f4fb; --card:#fff; --text:#1d1b26; --muted:#6b6880; --line:#dcd9e8; --accent:#5b3cc4; --accent-ink:#fff; --bad:#c0392b; --good:#1e8449; }
  @media (prefers-color-scheme: dark) { :root { --bg:#131219; --card:#1d1b26; --text:#eceaf4; --muted:#9d99b3; --line:#34313f; --accent:#8b6dff; --accent-ink:#fff; --bad:#ff7a6b; --good:#5fd38d; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.6 system-ui, "Segoe UI", Tahoma, sans-serif; }
  main { max-width:480px; margin:0 auto; padding:32px 16px 48px; }
  header { display:flex; align-items:center; gap:12px; margin-bottom:20px; }
  header img { width:48px; height:48px; }
  h1 { font-size:22px; margin:0; }
  header p { margin:0; color:var(--muted); font-size:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:20px; }
  label { display:block; font-size:14px; font-weight:600; margin:14px 0 6px; }
  label:first-child { margin-top:0; }
  input[type=text], input[type=password], input[type=url], select { width:100%; padding:11px 12px; border:1px solid var(--line); border-radius:10px; background:transparent; color:inherit; font:inherit; }
  input:focus, select:focus { outline:2px solid var(--accent); outline-offset:-1px; }
  .ltr { direction:ltr; text-align:left; }
  .checks { display:flex; flex-wrap:wrap; gap:8px 18px; }
  .checks label { display:flex; align-items:center; gap:6px; font-weight:400; margin:0; }
  .hint { color:var(--muted); font-size:13px; margin:4px 0 0; }
  button, .btn { display:block; width:100%; margin-top:20px; padding:12px; border:0; border-radius:10px; background:var(--accent); color:var(--accent-ink); font:inherit; font-weight:700; text-align:center; text-decoration:none; cursor:pointer; }
  .btn.secondary { background:transparent; color:var(--accent); border:1px solid var(--accent); margin-top:10px; }
  button:disabled { opacity:.6; cursor:wait; }
  #msg { margin-top:14px; font-size:14px; }
  #msg.bad { color:var(--bad); } #msg.good { color:var(--good); }
  #result { display:none; margin-top:16px; }
  #url { width:100%; font:13px ui-monospace, monospace; direction:ltr; padding:10px; border:1px solid var(--line); border-radius:10px; background:transparent; color:inherit; resize:none; }
  details { margin-top:14px; } summary { cursor:pointer; font-size:14px; color:var(--muted); }
</style>
</head>
<body>
<main>
  <header>
    <img src="/logo.svg" alt="">
    <div><h1>Xtream IPTV لـ Stremio</h1><p>قنوات مباشرة + أفلام + مسلسلات من اشتراك Xtream حقك</p></div>
  </header>
  <form class="card" id="f">
    <label for="server">رابط السيرفر</label>
    <input id="server" class="ltr" type="text" placeholder="http://example.com:8080" required autocomplete="url" inputmode="url">
    <label for="username">اليوزر</label>
    <input id="username" class="ltr" type="text" required autocomplete="username" autocapitalize="off" spellcheck="false">
    <label for="password">الباسورد</label>
    <input id="password" class="ltr" type="password" required autocomplete="current-password">

    <label for="epg">رابط EPG <span style="font-weight:400;color:var(--muted)">(اختياري)</span></label>
    <input id="epg" class="ltr" type="url" placeholder="https://…/guide.xml.gz" inputmode="url" autocapitalize="off" spellcheck="false">
    <p class="hint">أي رابط XMLTV (‎.xml أو ‎.xml.gz). يعرض "وش يعرض الحين" والبرامج الجاية لكل قناة. لو تركته فاضي يستخدم EPG السيرفر.
      <a href="#" id="arepg" style="color:var(--accent)">استخدم دليل القنوات العربية</a></p>

    <label>المحتوى</label>
    <div class="checks">
      <label><input type="checkbox" id="live" checked> قنوات مباشرة</label>
      <label><input type="checkbox" id="vod" checked> أفلام</label>
      <label><input type="checkbox" id="series" checked> مسلسلات</label>
    </div>

    <details>
      <summary>إعدادات إضافية</summary>
      <label for="format">صيغة البث المباشر</label>
      <select id="format"><option value="m3u8">HLS بس — لازم لأجهزة Apple و Odin (الافتراضي)</option><option value="ts">MPEG-TS أول + HLS — لـ VLC و Stremio بالكمبيوتر</option></select>
      <label for="name">اسم الإضافة في Stremio</label>
      <input id="name" type="text" placeholder="Xtream IPTV" maxlength="60">
      <p class="hint">مفيد لو بتركّب أكثر من اشتراك.</p>
    </details>

    <button id="go" type="submit">تحقّق وولّد رابط التركيب</button>
    <div id="msg" role="status"></div>

    <div id="result">
      <a id="install" class="btn" href="#">تركيب في Stremio</a>
      <a id="web" class="btn secondary" href="#" target="_blank" rel="noopener">تركيب من Stremio Web</a>
      <label for="url">أو انسخ الرابط والصقه في خانة البحث عن الإضافات:</label>
      <textarea id="url" rows="3" readonly></textarea>
      <button type="button" class="btn secondary" id="copy">نسخ الرابط</button>
      <p class="hint" id="enc"></p>
    </div>
  </form>
</main>
<script>
const $ = (id) => document.getElementById(id);
const msg = (t, cls) => { $("msg").textContent = t; $("msg").className = cls || ""; };
const ERR = {
  auth: "اليوزر أو الباسورد غلط، أو الاشتراك منتهي.",
  connect: "ما قدرت أتصل بالسيرفر. تأكد من الرابط والبورت (بعض السيرفرات تحجب سيرفرات الاستضافة).",
  missing: "عبّ كل الخانات.",
  "epg-url": "رابط الـ EPG لازم يبدأ بـ http:// أو https://",
  epg: "رابط الـ EPG ما اشتغل أو مو ملف XMLTV. تأكد منه أو خلّه فاضي.",
};
$("f").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  $("go").disabled = true; $("result").style.display = "none"; msg("جاري التحقق من الحساب…");
  try {
    const r = await fetch("/api/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        server: $("server").value, username: $("username").value, password: $("password").value,
        live: $("live").checked, vod: $("vod").checked, series: $("series").checked,
        format: $("format").value, name: $("name").value, epg: $("epg").value,
      }),
    });
    const d = await r.json();
    if (!r.ok) { msg((ERR[d.error] || "خطأ:") + (d.detail && d.error !== "auth" ? " (" + d.detail + ")" : ""), "bad"); return; }
    let t = "تم ✓ الحساب " + (d.account.status || "Active");
    if (d.account.exp) t += " — ينتهي " + new Date(d.account.exp * 1000).toLocaleDateString("ar");
    msg(t, "good");
    $("install").href = d.stremio;
    $("web").href = "https://web.stremio.com/#/addons?addon=" + encodeURIComponent(d.manifest);
    $("url").value = d.manifest;
    $("enc").textContent = d.encrypted ? "🔒 بيانات الدخول مشفّرة داخل الرابط." : "⚠️ الرابط فيه بيانات الدخول (غير مشفّر) — لا تشاركه مع أحد.";
    $("result").style.display = "block";
  } catch (e) {
    msg("صار خطأ بالاتصال: " + e.message, "bad");
  } finally { $("go").disabled = false; }
});
$("arepg").addEventListener("click", (e) => { e.preventDefault(); $("epg").value = "https://raw.githubusercontent.com/iimnm/arabic-epg/output/guide.xml.gz"; });
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("url").value); $("copy").textContent = "تم النسخ ✓"; }
  catch { $("url").select(); }
});
</script>
</body>
</html>`;
