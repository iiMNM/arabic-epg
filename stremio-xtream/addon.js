// Stremio addon for any Xtream Codes account: live TV, movies (VOD) and series.
// No dependencies. Platform independent: handle(Request) -> Response (Vercel, Deno Deploy, Node...).
//
// The Xtream server, username and password live inside the addon URL (a "config token"
// made by the /configure page). With CONFIG_SECRET set, the token is AES-GCM encrypted,
// so the credentials can't be read from the URL.
//
// Environment variables (all optional):
//   CONFIG_SECRET  encrypt config tokens with this secret (recommended; never change it,
//                  or installed addons stop working)
//   XT_UA          User-Agent sent to the Xtream API (default "IPTVSmartersPro")
//   DISPLAY_TZ     time zone for the "now playing" guide (default Asia/Riyadh)
//   CACHE_SECONDS  how long Xtream lists stay in memory (default 900)
//   EPG_CACHE_SECONDS  how long an external XMLTV guide stays in memory (default 10800)

import { getGuide, programmesFor, probeEpg } from "./epg.js";

const VERSION = "1.3.0";
const PAGE = 100;

const env = (k, d = "") =>
  (typeof process !== "undefined" && process.env && process.env[k]) ||
  (typeof Deno !== "undefined" && Deno.env.get(k)) ||
  d;

// ---------- config token ----------

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

let keyPromise = null;
function aesKey() {
  const secret = env("CONFIG_SECRET");
  if (!secret) return null;
  keyPromise ??= crypto.subtle
    .digest("SHA-256", enc.encode(secret))
    .then((raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]));
  return keyPromise;
}

export async function encodeConfig(cfg) {
  const data = enc.encode(JSON.stringify(cfg));
  const key = await aesKey();
  if (!key) return b64urlEncode(data);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return "x." + b64urlEncode(out);
}

export async function decodeConfig(token) {
  try {
    let bytes;
    if (token.startsWith("x.")) {
      const key = await aesKey();
      if (!key) return null;
      const raw = b64urlDecode(token.slice(2));
      bytes = new Uint8Array(
        await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12))
      );
    } else {
      bytes = b64urlDecode(token);
    }
    const cfg = JSON.parse(dec.decode(bytes));
    return cfg && cfg.s && cfg.u && cfg.p ? cfg : null;
  } catch {
    return null;
  }
}

export function normalizeServer(s) {
  s = String(s || "").trim().replace(/\/+$/, "");
  if (s && !/^https?:\/\//i.test(s)) s = "http://" + s;
  // people often paste a full player_api / get.php link
  s = s.replace(/\/(player_api|get|panel_api|xmltv)\.php.*$/i, "");
  return s;
}

// ---------- Xtream API ----------

const cache = new Map();

async function xtream(cfg, action, params = {}, ttl) {
  const q = new URLSearchParams({ username: cfg.u, password: cfg.p, ...(action ? { action } : {}), ...params });
  const url = `${cfg.s}/player_api.php?${q}`;
  const maxAge = (ttl ?? Number(env("CACHE_SECONDS", "900"))) * 1000;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < maxAge) return hit.data;

  const r = await fetch(url, {
    headers: { "User-Agent": env("XT_UA", "IPTVSmartersPro"), Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) {
    if (hit) return hit.data;
    throw new Error(`Xtream API HTTP ${r.status}`);
  }
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("Xtream API returned non-JSON (wrong server URL?)");
  }
  if (cache.size > 300) cache.clear();
  cache.set(url, { at: Date.now(), data });
  return data;
}

const asArray = (x) => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : []);

const KINDS = {
  live: { type: "tv", cats: "get_live_categories", list: "get_live_streams", idKey: "stream_id", icon: "stream_icon" },
  vod: { type: "movie", cats: "get_vod_categories", list: "get_vod_streams", idKey: "stream_id", icon: "stream_icon" },
  series: { type: "series", cats: "get_series_categories", list: "get_series", idKey: "series_id", icon: "cover" },
};

async function categories(cfg, kind) {
  return asArray(await xtream(cfg, KINDS[kind].cats)).filter((c) => c && c.category_name);
}
async function items(cfg, kind) {
  return asArray(await xtream(cfg, KINDS[kind].list)).filter((x) => x && x[KINDS[kind].idKey] != null);
}

function decodeB64Text(s) {
  if (!s) return "";
  try {
    return dec.decode(b64urlDecode(String(s).replace(/=+$/, "")));
  } catch {
    return String(s);
  }
}

const ext = (x, d) => (String(x || "").replace(/[^a-z0-9]/gi, "") || d).toLowerCase();
const img = (u) => (u && /^https?:\/\//i.test(u) ? u : undefined);
const year = (d) => (String(d || "").match(/\b(19|20)\d{2}\b/) || [])[0];

// ---------- Stremio ids ----------
//   xt:live:<stream_id>
//   xt:vod:<stream_id>:<ext>
//   xt:series:<series_id>
//   xt:ep:<episode_id>:<ext>

function toMeta(kind, x) {
  if (kind === "live") {
    return {
      id: `xt:live:${x.stream_id}`,
      type: "tv",
      name: x.name,
      poster: img(x.stream_icon),
      logo: img(x.stream_icon),
      posterShape: "square",
    };
  }
  if (kind === "vod") {
    return {
      id: `xt:vod:${x.stream_id}:${ext(x.container_extension, "mp4")}`,
      type: "movie",
      name: x.name,
      poster: img(x.stream_icon),
      posterShape: "poster",
      releaseInfo: year(x.year || x.releaseDate),
      imdbRating: x.rating && Number(x.rating) ? String(x.rating) : undefined,
    };
  }
  return {
    id: `xt:series:${x.series_id}`,
    type: "series",
    name: x.name,
    poster: img(x.cover),
    posterShape: "poster",
    releaseInfo: year(x.releaseDate || x.release_date || x.year),
    imdbRating: x.rating && Number(x.rating) ? String(x.rating) : undefined,
  };
}

// ---------- manifest ----------

const LABELS = { live: "Live TV", vod: "Movies", series: "Series" };

export async function manifest(cfg, base) {
  const m = {
    id: "org.mnm.xtream",
    version: VERSION,
    name: "Xtream IPTV",
    description: "Live TV, movies and series from your Xtream Codes account.",
    logo: `${base}/logo.svg`,
    resources: ["catalog", "meta", "stream"],
    types: ["tv", "movie", "series"],
    idPrefixes: ["xt:"],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: !cfg },
  };
  if (!cfg) return m;

  const host = (() => {
    try {
      return new URL(cfg.s).hostname;
    } catch {
      return "";
    }
  })();
  m.name = cfg.n || `Xtream IPTV${host ? ` (${host})` : ""}`;
  m.id = `org.mnm.xtream.${hashStr(cfg.s + "|" + cfg.u)}`;

  for (const kind of ["live", "vod", "series"]) {
    if (cfg[kind] === 0) continue;
    let options = [];
    try {
      options = [...new Set((await categories(cfg, kind)).map((c) => String(c.category_name).trim()))];
    } catch {}
    m.catalogs.push({
      type: KINDS[kind].type,
      id: `xt-${kind}`,
      name: LABELS[kind],
      extra: [
        { name: "genre", options, isRequired: false },
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false },
        // programme guide (Stremio's Live TV guide, AIOStreams / Jellyfin apps such as Odin)
        ...(kind === "live" ? [{ name: "date", isRequired: false }, { name: "ids", isRequired: false }] : []),
      ],
      genres: options,
    });
  }
  if (cfg.live !== 0) m.behaviorHints.epgProvider = true;
  return m;
}

function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// ---------- catalog ----------

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[ً-ٰٟ]/g, "") // Arabic diacritics
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

async function catalog(cfg, catalogId, extra) {
  const kind = catalogId.replace(/^xt-/, "");
  if (!KINDS[kind]) return { metas: [] };
  if (kind === "live") return liveCatalog(cfg, extra);
  let list = await items(cfg, kind);

  if (extra.genre) {
    const ids = new Set(
      (await categories(cfg, kind))
        .filter((c) => String(c.category_name).trim() === extra.genre)
        .map((c) => String(c.category_id))
    );
    list = list.filter((x) => ids.has(String(x.category_id)) || asArray(x.category_ids).some((id) => ids.has(String(id))));
  }
  if (extra.search) {
    const words = norm(extra.search).split(" ").filter(Boolean);
    list = list.filter((x) => {
      const n = norm(x.name);
      return words.every((w) => n.includes(w));
    });
  }
  if (kind !== "live" && !extra.genre && !extra.search) {
    // newest first on the home board
    list = [...list].sort((a, b) => Number(b.added || b.last_modified || 0) - Number(a.added || a.last_modified || 0));
  }
  const skip = Math.max(0, parseInt(extra.skip || "0", 10) || 0);
  return { metas: list.slice(skip, skip + PAGE).map((x) => toMeta(kind, x)) };
}

// ---------- live TV: channel numbers, groups and the programme guide ----------

const liveIndex = new WeakMap(); // stream list -> { number, byId }
function indexOf(list) {
  let ix = liveIndex.get(list);
  if (!ix) {
    ix = { number: new Map(), byId: new Map() };
    list.forEach((x, i) => {
      ix.number.set(String(x.stream_id), String(Number(x.num) || i + 1));
      ix.byId.set(String(x.stream_id), x);
    });
    liveIndex.set(list, ix);
  }
  return ix;
}

async function liveContext(cfg) {
  const [list, cats] = await Promise.all([items(cfg, "live"), categories(cfg, "live").catch(() => [])]);
  const catName = new Map(cats.map((c) => [String(c.category_id), String(c.category_name).trim()]));
  return { list, cats, catName, ix: indexOf(list) };
}

function channelMeta(ctx, x) {
  const group = ctx.catName.get(String(x.category_id));
  return { ...toMeta("live", x), channelNumber: ctx.ix.number.get(String(x.stream_id)), genres: group ? [group] : undefined };
}

const iso = (t) => new Date(t * 1000).toISOString();
function videosOf(x, progs) {
  return progs.map((p) => ({
    id: `xt:live:${x.stream_id}:${p.start}`,
    title: p.title,
    startTime: iso(p.start),
    endTime: iso(p.stop),
    released: iso(p.start),
    overview: p.desc || undefined,
  }));
}

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);
async function pool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) await fn(list[i++]).catch(() => {});
  }));
}

// Servers whose short EPG keeps coming back empty (e.g. an M3U-to-Xtream bridge): stop asking for a while,
// instead of one request per channel on every guide page.
const noShortEpg = new Map(); // server -> { empties, until }
async function shortEpg(cfg, x, limit = 10) {
  const st = noShortEpg.get(cfg.s) || { empties: 0, until: 0 };
  if (st.until > Date.now()) return [];
  const r = await xtream(cfg, "get_short_epg", { stream_id: x.stream_id, limit: String(limit) }, 3600);
  const list = asArray(r && r.epg_listings);
  if (list.length) st.empties = 0;
  else if (++st.empties >= 8) { st.until = Date.now() + 6 * 3600 * 1000; st.empties = 0; }
  noShortEpg.set(cfg.s, st);
  return list
    .map((e) => ({
      start: Number(e.start_timestamp),
      stop: Number(e.stop_timestamp),
      title: decodeB64Text(e.title),
      desc: decodeB64Text(e.description),
    }))
    .filter((e) => e.stop > e.start && e.title);
}

// Programmes in [from, to) per stream id: the external XMLTV first, the Xtream EPG for the rest.
async function schedules(cfg, chans, from, to, waitMs = 8000) {
  const out = new Map();
  const guide = cfg.e ? await withTimeout(getGuide(cfg.e, true), waitMs) : null;
  const missing = [];
  for (const x of chans) {
    const p = guide ? programmesFor(guide, x, from, to) : null;
    if (p && p.length) out.set(String(x.stream_id), p);
    else if (x.epg_channel_id) missing.push(x); // the server has no guide for channels without an EPG id
  }
  const now = Date.now() / 1000;
  if (missing.length && to > now && from < now + 86400) {
    await withTimeout(
      pool(missing, 6, async (x) => {
        const p = (await shortEpg(cfg, x)).filter((e) => e.stop > from && e.start < to);
        if (p.length) out.set(String(x.stream_id), p);
      }),
      waitMs
    );
  }
  return out;
}

async function liveCatalog(cfg, extra) {
  const ctx = await liveContext(cfg);
  let list = ctx.list;
  if (extra.ids) {
    list = extra.ids
      .split(",")
      .map((id) => ctx.ix.byId.get(id.trim().replace(/^xt:live:/, "")))
      .filter(Boolean)
      .slice(0, 200);
  } else {
    if (extra.genre) {
      const ids = new Set(ctx.cats.filter((c) => String(c.category_name).trim() === extra.genre).map((c) => String(c.category_id)));
      list = list.filter((x) => ids.has(String(x.category_id)) || asArray(x.category_ids).some((id) => ids.has(String(id))));
    }
    if (extra.search) {
      const words = norm(extra.search).split(" ").filter(Boolean);
      list = list.filter((x) => words.every((w) => norm(x.name).includes(w)));
    }
    const skip = Math.max(0, parseInt(extra.skip || "0", 10) || 0);
    list = list.slice(skip, skip + PAGE);
  }

  const day = /^\d{4}-\d{2}-\d{2}$/.test(extra.date || "") ? Date.parse(`${extra.date}T00:00:00Z`) / 1000 : NaN;
  if (!Number.isNaN(day)) {
    const sched = await schedules(cfg, list, day, day + 86400);
    return { metasDetailed: list.map((x) => ({ ...channelMeta(ctx, x), videos: videosOf(x, sched.get(String(x.stream_id)) || []) })) };
  }

  // plain list: "now playing" under each channel when the external guide is already in memory (never blocks)
  const guide = cfg.e ? await getGuide(cfg.e, false) : null;
  const now = Date.now() / 1000;
  const metas = list.map((x) => {
    const cur = guide && (programmesFor(guide, x, now, now + 1) || [])[0];
    return { ...channelMeta(ctx, x), description: cur ? `▶ ${cur.title}` : undefined };
  });
  return extra.ids ? { metasDetailed: metas } : { metas };
}

// ---------- meta ----------

function fmtTime(ts) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: env("DISPLAY_TZ", "Asia/Riyadh"),
    }).format(new Date(Number(ts) * 1000));
  } catch {
    return "";
  }
}

function guideText(progs) {
  if (!progs.length) return undefined;
  const now = Date.now() / 1000;
  const lines = progs.slice(0, 6).map((p) => {
    const on = p.start <= now && p.stop > now;
    return `${on ? "▶ " : ""}${fmtTime(p.start)}–${fmtTime(p.stop)}  ${p.title}`;
  });
  const cur = progs[0].start <= now ? progs[0] : null;
  if (cur && cur.desc) lines.splice(1, 0, cur.desc.slice(0, 300), "");
  return lines.join("\n");
}

async function meta(cfg, type, id) {
  const [, kind, xid] = id.split(":");

  if (kind === "live") {
    const ctx = await liveContext(cfg);
    const x = ctx.ix.byId.get(xid);
    if (!x) return { meta: null };
    const now = Date.now() / 1000;
    const progs = (await schedules(cfg, [x], now - 3 * 3600, now + 2 * 86400)).get(xid) || [];
    const id0 = `xt:live:${xid}`;
    return {
      meta: {
        ...channelMeta(ctx, x),
        id: id0,
        background: img(x.stream_icon),
        description: guideText(progs.filter((p) => p.stop > now)),
        videos: videosOf(x, progs),
        behaviorHints: { defaultVideoId: id0, isLive: true },
      },
    };
  }

  if (kind === "vod") {
    const r = await xtream(cfg, "get_vod_info", { vod_id: xid });
    const info = (r && r.info) || {};
    const md = (r && r.movie_data) || {};
    const backdrop = asArray(info.backdrop_path)[0];
    const trailer = info.youtube_trailer || info.trailer;
    return {
      meta: {
        id,
        type: "movie",
        name: md.name || info.name || info.o_name || "Movie",
        poster: img(info.movie_image || info.cover_big),
        background: img(backdrop) || img(info.cover_big) || img(info.movie_image),
        description: info.plot || info.description || undefined,
        releaseInfo: year(info.releasedate || info.release_date),
        released: isoDate(info.releasedate || info.release_date),
        runtime: info.duration || (info.episode_run_time ? `${info.episode_run_time} min` : undefined),
        genres: splitList(info.genre),
        director: splitList(info.director),
        cast: splitList(info.cast || info.actors),
        imdbRating: info.rating && Number(info.rating) ? String(info.rating) : undefined,
        trailers: trailer ? [{ source: trailer, type: "Trailer" }] : undefined,
        behaviorHints: { defaultVideoId: id },
      },
    };
  }

  if (kind === "series") {
    const r = await xtream(cfg, "get_series_info", { series_id: xid });
    const info = (r && r.info) || {};
    const videos = [];
    const eps = r && r.episodes;
    const groups = Array.isArray(eps) ? { 1: eps.flat() } : eps || {};
    for (const [seasonKey, list] of Object.entries(groups)) {
      for (const e of asArray(list)) {
        if (!e || e.id == null) continue;
        const ei = e.info || {};
        videos.push({
          id: `xt:ep:${e.id}:${ext(e.container_extension, "mp4")}`,
          title: e.title || `Episode ${e.episode_num}`,
          season: Number(e.season ?? seasonKey) || 1,
          episode: Number(e.episode_num) || videos.length + 1,
          released: isoDate(ei.releasedate || ei.air_date) || new Date(0).toISOString(),
          thumbnail: img(ei.movie_image || ei.cover_big),
          overview: ei.plot || undefined,
        });
      }
    }
    videos.sort((a, b) => a.season - b.season || a.episode - b.episode);
    const backdrop = asArray(info.backdrop_path)[0];
    return {
      meta: {
        id,
        type: "series",
        name: info.name || "Series",
        poster: img(info.cover),
        background: img(backdrop) || img(info.cover),
        description: info.plot || undefined,
        releaseInfo: year(info.releaseDate || info.release_date),
        genres: splitList(info.genre),
        director: splitList(info.director),
        cast: splitList(info.cast),
        imdbRating: info.rating && Number(info.rating) ? String(info.rating) : undefined,
        trailers: info.youtube_trailer ? [{ source: info.youtube_trailer, type: "Trailer" }] : undefined,
        videos,
      },
    };
  }
  return { meta: null };
}

function splitList(s) {
  const a = String(s || "")
    .split(/\s*[,/|]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
  return a.length ? a.slice(0, 10) : undefined;
}
function isoDate(s) {
  const d = new Date(String(s || "").trim());
  return s && !isNaN(d) ? d.toISOString() : undefined;
}

// ---------- streams ----------

async function streams(cfg, id) {
  const [, kind, xid, e] = id.split(":");
  const u = encodeURIComponent(cfg.u), p = encodeURIComponent(cfg.p);
  const hints = { notWebReady: true, bingeGroup: `xtream-${kind}` };
  if (kind === "live") {
    // One HLS link by default. Apple players (Odin, Infuse, AVPlayer) can't play MPEG-TS, and
    // AIOStreams re-sorts an addon's links by stream type (HLS counts as "live", .ts as "http"),
    // so offering both can put the .ts first and Odin plays only the first one.
    // MPEG-TS is added only when chosen on the configure page (players such as VLC/Stremio desktop).
    const hls = { name: "Xtream", description: "HLS", url: `${cfg.s}/live/${u}/${p}/${xid}.m3u8`, behaviorHints: { bingeGroup: "xtream-live" } };
    if (cfg.f !== "ts") return { streams: [hls] };
    const ts = { name: "Xtream", description: "MPEG-TS", url: `${cfg.s}/live/${u}/${p}/${xid}.ts`, behaviorHints: { notWebReady: true, bingeGroup: "xtream-live" } };
    return { streams: [ts, hls] };
  }
  if (kind === "vod") {
    return { streams: [{ name: "Xtream", title: `🎬 ${(e || "mp4").toUpperCase()}`, url: `${cfg.s}/movie/${u}/${p}/${xid}.${ext(e, "mp4")}`, behaviorHints: hints }] };
  }
  if (kind === "ep") {
    return { streams: [{ name: "Xtream", title: `📺 ${(e || "mp4").toUpperCase()}`, url: `${cfg.s}/series/${u}/${p}/${xid}.${ext(e, "mp4")}`, behaviorHints: hints }] };
  }
  return { streams: [] };
}

// ---------- diagnostics (/<token>/diag) ----------
// Probes one live channel from the server side and reports what each format returns,
// with the username and password masked, so playback problems can be pinned down.

async function probeUrl(url, mask) {
  const out = { hops: [] };
  let cur = url;
  try {
    for (let i = 0; i < 6; i++) {
      const r = await fetch(cur, {
        redirect: "manual",
        headers: { "User-Agent": env("XT_UA", "IPTVSmartersPro") },
        signal: AbortSignal.timeout(10000),
      });
      out.hops.push({ status: r.status, url: mask(cur) });
      const loc = r.headers.get("location");
      if (r.status >= 300 && r.status < 400 && loc) {
        r.body?.cancel().catch(() => {});
        cur = new URL(loc, cur).href;
        continue;
      }
      out.status = r.status;
      out.contentType = r.headers.get("content-type");
      const reader = r.body?.getReader();
      let bytes = new Uint8Array();
      while (reader && bytes.length < 4096) {
        const { value, done } = await reader.read();
        if (value) { const b = new Uint8Array(bytes.length + value.length); b.set(bytes); b.set(value, bytes.length); bytes = b; }
        if (done) break;
      }
      reader?.cancel().catch(() => {});
      const text = dec.decode(bytes.slice(0, 4096));
      if (text.startsWith("#EXTM3U")) {
        out.kind = "HLS playlist";
        const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
        out.playlistEntries = lines.slice(0, 3).map((l) => mask(new URL(l, cur).href));
        out.hasVariants = /#EXT-X-STREAM-INF/.test(text);
      } else if (bytes[0] === 0x47 && bytes[188] === 0x47) out.kind = "MPEG-TS video";
      else out.kind = bytes.length ? `other (${JSON.stringify(text.slice(0, 80))})` : "empty";
      break;
    }
  } catch (e) {
    out.error = e.message;
  }
  out.finalScheme = cur.split(":")[0];
  return out;
}

async function diag(cfg, url) {
  const secrets = [cfg.u, cfg.p, encodeURIComponent(cfg.u), encodeURIComponent(cfg.p)].filter((x) => x && x.length > 1);
  const mask = (s) => secrets.reduce((acc, x) => acc.split(x).join("***"), String(s));
  const info = await xtream(cfg, "", {}, 0).catch((e) => ({ error: e.message }));
  const list = await items(cfg, "live").catch(() => []);
  const id = url.searchParams.get("id");
  const ch = (id && list.find((x) => String(x.stream_id) === id)) || list[0];
  const result = {
    server: mask(cfg.s),
    account: info && info.user_info ? {
      auth: info.user_info.auth,
      status: info.user_info.status,
      allowed_output_formats: info.user_info.allowed_output_formats,
      max_connections: info.user_info.max_connections,
      active_cons: info.user_info.active_cons,
    } : info,
    server_info: info && info.server_info ? { url: info.server_info.url, port: info.server_info.port, https_port: info.server_info.https_port, protocol: info.server_info.server_protocol } : undefined,
    channels: list.length,
    tested: ch ? { stream_id: ch.stream_id, name: ch.name, direct_source: ch.direct_source ? mask(ch.direct_source) : "" } : null,
    offered: ch ? (await streams(cfg, `xt:live:${ch.stream_id}`)).streams.map((s) => mask(s.url)) : [],
    probes: {},
  };
  if (ch) {
    const u = encodeURIComponent(cfg.u), p = encodeURIComponent(cfg.p);
    for (const f of ["m3u8", "ts"]) result.probes[f] = await probeUrl(`${cfg.s}/live/${u}/${p}/${ch.stream_id}.${f}`, mask);
  }
  return result;
}

// ---------- HTTP ----------

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="#5b3cc4"/><rect x="48" y="72" width="160" height="108" rx="14" fill="none" stroke="#fff" stroke-width="14"/><path d="M100 204h56M112 46l16 22 16-22" stroke="#fff" stroke-width="14" stroke-linecap="round" fill="none"/><path d="M112 104v44l38-22z" fill="#fff"/></svg>`;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

const json = (obj, maxAge = 0, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...CORS,
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store",
      // Vercel's CDN keeps the answer and serves repeats from the edge without running the function
      ...(maxAge ? { "vercel-cdn-cache-control": `max-age=${maxAge}, stale-while-revalidate=${maxAge * 6}, stale-if-error=86400` } : {}),
    },
  });

function parseExtra(s) {
  const out = {};
  if (!s) return out;
  for (const [k, v] of new URLSearchParams(s)) out[k] = v;
  return out;
}

async function makeLink(request, base) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad request" }, 0, 400);
  }
  const cfg = {
    s: normalizeServer(body.server),
    u: String(body.username || "").trim(),
    p: String(body.password || "").trim(),
  };
  if (!cfg.s || !cfg.u || !cfg.p) return json({ error: "missing" }, 0, 400);
  for (const k of ["live", "vod", "series"]) if (body[k] === false) cfg[k] = 0;
  if (body.format === "ts") cfg.f = "ts";
  if (body.name) cfg.n = String(body.name).trim().slice(0, 60);
  const epg = String(body.epg || "").trim();
  if (epg) {
    if (!/^https?:\/\/\S+$/i.test(epg)) return json({ error: "epg-url" }, 0, 400);
    cfg.e = epg;
  }

  let info;
  try {
    info = await xtream(cfg, "", {}, 0);
  } catch (e) {
    return json({ error: "connect", detail: e.message }, 0, 502);
  }
  const ui = info && info.user_info;
  if (!ui || Number(ui.auth) !== 1) return json({ error: "auth" }, 0, 401);

  const epgProblem = cfg.e ? await probeEpg(cfg.e) : null;
  if (epgProblem) return json({ error: "epg", detail: epgProblem }, 0, 400);
  if (cfg.e) getGuide(cfg.e).catch(() => {}); // warm the cache

  const token = await encodeConfig(cfg);
  const manifestUrl = `${base}/${token}/manifest.json`;
  return json({
    manifest: manifestUrl,
    stremio: manifestUrl.replace(/^https?:\/\//, "stremio://"),
    encrypted: token.startsWith("x."),
    account: {
      status: ui.status,
      exp: ui.exp_date ? Number(ui.exp_date) : null,
      maxConnections: ui.max_connections,
    },
  });
}

export async function handle(request, configurePage) {
  const url = new URL(request.url);
  const path = (url.searchParams.get("__path") || url.pathname).replace(/\/+$/, "") || "/";
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  const base = `${proto}://${request.headers.get("x-forwarded-host") || url.host}`;

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  try {
    if (path === "/") return Response.redirect(`${base}/configure`, 302);
    if (path === "/api/link" && request.method === "POST") return makeLink(request, base);
    if (path === "/configure" || /^\/[^/]+\/configure$/.test(path)) {
      return new Response(configurePage, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    if (path === "/manifest.json") return json(await manifest(null, base), 3600);
    if (path === "/logo.svg") {
      return new Response(LOGO, { headers: { ...CORS, "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
    }

    const dm = path.match(/^\/([^/]+)\/diag$/);
    if (dm) {
      const dcfg = await decodeConfig(dm[1]);
      if (!dcfg) return json({ error: "invalid config" }, 0, 400);
      return new Response(JSON.stringify(await diag(dcfg, url), null, 2), {
        headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
    const m = path.match(/^\/([^/]+)\/(manifest\.json|(catalog|meta|stream)\/([^/]+)\/([^/]+?)(?:\/([^/]+))?\.json)$/);
    if (!m) return new Response("Not found", { status: 404, headers: CORS });
    const [, token, file, resource, type, rawId, rawExtra] = m;
    const cfg = await decodeConfig(token);
    if (!cfg) return json({ error: "invalid config, reinstall the addon from /configure" }, 0, 400);

    if (file === "manifest.json") return json(await manifest(cfg, base), 3600);

    const id = decodeURIComponent(rawId);
    if (resource === "catalog") {
      const extra = parseExtra(rawExtra && decodeURIComponent(rawExtra));
      try {
        const guideAsked = !!extra.date || !!extra.ids;
        return json({ ...(await catalog(cfg, id, extra)), cacheMaxAge: guideAsked ? 900 : 600 }, guideAsked ? 900 : 600);
      } catch (e) {
        console.error("catalog", e.message);
        return json({ metas: [], cacheMaxAge: 30 }, 30);
      }
    }
    if (!id.startsWith("xt:")) return json(resource === "meta" ? { meta: null } : { streams: [] }, 3600);
    if (resource === "meta") return json({ ...(await meta(cfg, type, id)), cacheMaxAge: id.startsWith("xt:live") ? 300 : 3600 }, 300);
    if (resource === "stream") {
      const live = id.startsWith("xt:live:");
      return json({ ...(await streams(cfg, id)), cacheMaxAge: live ? 300 : 3600 }, live ? 300 : 3600);
    }
  } catch (e) {
    console.error(e);
    return json({ error: e.message }, 0, 500);
  }
  return new Response("Not found", { status: 404, headers: CORS });
}
