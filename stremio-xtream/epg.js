// External XMLTV guide (plain .xml or .xml.gz), streamed and kept in memory per URL.
// Only programmes from the last hour to the next 24 hours are stored, so even big guides stay small.

const EPG_TTL = () => Number(globalThis.process?.env?.EPG_CACHE_SECONDS || 3 * 3600) * 1000;
const guides = new Map(); // url -> { at, data, promise }

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unescapeXml(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
      e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m
    )
    .trim();
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? unescapeXml(m[2] ?? m[3]) : "";
};
const child = (block, name) => {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? unescapeXml(m[1]) : "";
};

// "20261127120000 +0300" -> unix seconds
export function xmltvTime(s) {
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{2}):?(\d{2})?/);
  if (!m) return NaN;
  const [, y, mo, d, h, mi, se = "0", oh = "+00", om = "00"] = m;
  const off = (Math.abs(+oh) * 60 + +om) * (oh.startsWith("-") ? -1 : 1);
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +se) / 1000 - off * 60;
}

// Channel name -> comparable key: drop quality / country tags and punctuation.
export function nameKey(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/^\s*[a-z]{2,3}\s*[:|\-]\s*/i, "") // "AR: ", "SA | "
    .replace(/\b(uhd|fhd|hd|sd|hevc|h265|4k|8k|1080p?|720p?|backup|raw|vip|\+1)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}
const idKey = (s) => String(s || "").toLowerCase().replace(/@.*$/, "").trim();

async function openStream(url) {
  const r = await fetch(url, { headers: { "User-Agent": "stremio-xtream" }, signal: AbortSignal.timeout(90000) });
  if (!r.ok || !r.body) throw new Error(`EPG HTTP ${r.status}`);
  const reader = r.body.getReader();
  const first = await reader.read();
  const head = first.value || new Uint8Array();
  let stream = new ReadableStream({
    start(c) {
      if (head.length) c.enqueue(head);
      if (first.done) c.close();
    },
    async pull(c) {
      const { value, done } = await reader.read();
      if (done) c.close();
      else c.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  if (head[0] === 0x1f && head[1] === 0x8b) stream = stream.pipeThrough(new DecompressionStream("gzip"));
  return stream.pipeThrough(new TextDecoderStream());
}

async function loadGuide(url) {
  const now = Date.now() / 1000;
  const from = now - 3600, to = now + 24 * 3600;
  const progs = new Map(); // channel id -> [{start, stop, title, desc}]
  const byId = new Map(); // idKey -> channel id
  const names = new Map(); // nameKey -> Set of channel ids

  let buf = "";
  const re = /<(channel|programme)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  const reader = (await openStream(url)).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += value;
    re.lastIndex = 0;
    let m, end = 0;
    while ((m = re.exec(buf))) {
      end = re.lastIndex;
      const [, kind, attrs, , body = ""] = m;
      const id = attr(attrs, "id") || attr(attrs, "channel");
      if (!id) continue;
      if (kind === "channel") {
        if (!byId.has(idKey(id))) byId.set(idKey(id), id);
        for (const dn of body.matchAll(/<display-name\b[^>]*>([\s\S]*?)<\/display-name>/gi)) {
          const k = nameKey(unescapeXml(dn[1]));
          if (!k) continue;
          if (!names.has(k)) names.set(k, new Set());
          names.get(k).add(id);
        }
      } else {
        const start = xmltvTime(attr(attrs, "start")), stop = xmltvTime(attr(attrs, "stop"));
        if (!(stop > from && start < to)) continue;
        if (!progs.has(id)) progs.set(id, []);
        progs.get(id).push({ start, stop, title: child(body, "title"), desc: child(body, "desc") });
        if (!byId.has(idKey(id))) byId.set(idKey(id), id);
      }
    }
    // keep only the unfinished tail; also drop junk before the next tag
    buf = buf.slice(end);
    if (end === 0 && buf.length > 4e6) buf = buf.slice(buf.lastIndexOf("<"));
    if (done) break;
  }
  for (const list of progs.values()) list.sort((a, b) => a.start - b.start);
  // a name can belong to several channels (one per source site): keep the one with the most distinct titles
  const score = (id) => new Set((progs.get(id) || []).map((p) => p.title)).size;
  const byName = new Map();
  for (const [k, ids] of names) byName.set(k, [...ids].sort((a, b) => score(b) - score(a))[0]);
  return { progs, byId, byName, loadedAt: Date.now() };
}

// Returns the guide if loaded; starts (or awaits, with wait=true) a load otherwise.
export async function getGuide(url, wait = true) {
  let g = guides.get(url);
  const fresh = g && g.data && Date.now() - g.at < EPG_TTL();
  if (fresh) return g.data;
  if (!g || !g.promise) {
    const promise = loadGuide(url)
      .then((data) => {
        guides.set(url, { at: Date.now(), data, promise: null });
        return data;
      })
      .catch((e) => {
        console.error("epg", url, e.message);
        const old = guides.get(url);
        guides.set(url, { at: Date.now() - EPG_TTL() + 300000, data: old?.data || null, promise: null }); // retry in 5 min
        return old?.data || null;
      });
    if (guides.size > 20) guides.clear();
    g = { at: g?.at || 0, data: g?.data || null, promise };
    guides.set(url, g);
  }
  if (g.data) return g.data; // serve stale while refreshing
  return wait ? g.promise : null;
}

// Programmes for an Xtream live stream, matched by epg_channel_id then by name.
export function programmesFor(guide, stream) {
  if (!guide) return null;
  const eid = String(stream.epg_channel_id || "").trim();
  let ch = eid && (guide.progs.has(eid) ? eid : guide.byId.get(idKey(eid)));
  if (!ch || !guide.progs.has(ch)) ch = guide.byName.get(nameKey(stream.name)) || null;
  if (!ch) return null;
  const now = Date.now() / 1000;
  return (guide.progs.get(ch) || []).filter((p) => p.stop > now);
}

// Quick check that a URL answers and looks like XMLTV (reads only the first bytes).
export async function probeEpg(url) {
  try {
    const reader = (await openStream(url)).getReader();
    let text = "";
    while (text.length < 2048) {
      const { value, done } = await reader.read();
      if (value) text += value;
      if (done) break;
    }
    reader.cancel().catch(() => {});
    return /<tv\b|<\?xml|<channel\b|<programme\b/i.test(text) ? null : "not-xmltv";
  } catch (e) {
    return e.message || "unreachable";
  }
}
