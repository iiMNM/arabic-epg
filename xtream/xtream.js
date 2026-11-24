// Minimal Xtream Codes API server built from an M3U playlist + an XMLTV EPG.
// Platform independent: handle(Request) -> Response (Vercel, Deno Deploy, Node, Render...).
//
// Environment variables:
//   M3U_URL        playlist URL (raw.githubusercontent.com/... of a private repo is fine)
//   GITHUB_TOKEN   token with read access to the private repo (only if M3U_URL is private)
//   EPG_URL        XMLTV URL (default: my-epg)
//   XT_USER        login username
//   XT_PASS        login password
//   CACHE_SECONDS  how long to keep the playlist in memory (default 600)

const env = (k, d = "") =>
  (typeof process !== "undefined" && process.env && process.env[k]) ||
  (typeof Deno !== "undefined" && Deno.env.get(k)) ||
  d;

const DEFAULT_EPG = "https://raw.githubusercontent.com/iimnm/my-epg/epg/epg.xml.gz";

let cache = { at: 0, data: null };

// Stable numeric id from a string (FNV-1a 32 bit), so favourites survive playlist edits.
function hashId(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 2000000000 + 1;
}

function attr(line, name) {
  const m = line.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return m ? m[1].trim() : "";
}

export function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  const categories = [];
  const catIds = new Map();
  const usedIds = new Set();
  let cur = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const comma = line.lastIndexOf(",");
      cur = {
        name: (comma >= 0 ? line.slice(comma + 1) : "").trim() || attr(line, "tvg-name"),
        tvgId: attr(line, "tvg-id"),
        logo: attr(line, "tvg-logo"),
        group: attr(line, "group-title") || "Other",
      };
    } else if (line.startsWith("#EXTGRP:") && cur) {
      cur.group = line.slice(8).trim() || cur.group;
    } else if (!line.startsWith("#") && cur) {
      cur.url = line;
      if (!catIds.has(cur.group)) {
        const id = String(categories.length + 1);
        catIds.set(cur.group, id);
        categories.push({ category_id: id, category_name: cur.group, parent_id: 0 });
      }
      cur.categoryId = catIds.get(cur.group);
      let id = hashId(cur.name + "|" + cur.group);
      while (usedIds.has(id)) id++;
      usedIds.add(id);
      cur.id = id;
      cur.num = channels.length + 1;
      channels.push(cur);
      cur = null;
    }
  }
  return { channels, categories, byId: new Map(channels.map((c) => [c.id, c])) };
}

async function loadPlaylist() {
  const ttl = Number(env("CACHE_SECONDS", "600")) * 1000;
  if (cache.data && Date.now() - cache.at < ttl) return cache.data;
  const url = env("M3U_URL");
  if (!url) {
    // No URL: use a playlist file bundled with the deployment (api/_playlist.m3u, never served statically).
    const fs = await import("node:fs");
    const candidates = [new URL("./api/_playlist.m3u", import.meta.url), `${process.cwd()}/api/_playlist.m3u`];
    for (const f of candidates) {
      try {
        cache = { at: Date.now(), data: parseM3U(fs.readFileSync(f, "utf8")) };
        return cache.data;
      } catch {}
    }
    throw new Error("M3U_URL is not set and no api/_playlist.m3u is bundled");
  }
  const headers = { "User-Agent": "xtream-bridge" };
  const token = env("GITHUB_TOKEN");
  if (token) headers.Authorization = `token ${token}`;
  const r = await fetch(url, { headers });
  if (!r.ok) {
    if (cache.data) return cache.data; // keep serving the old copy
    throw new Error(`playlist download failed: HTTP ${r.status}`);
  }
  cache = { at: Date.now(), data: parseM3U(await r.text()) };
  return cache.data;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
  });

function authOk(u, p) {
  const U = env("XT_USER"), P = env("XT_PASS");
  return U && P && u === U && p === P;
}

function streamExt(url) {
  const m = url.split("?")[0].match(/\.(m3u8|ts|mp4|mkv)$/i);
  return m ? m[1].toLowerCase() : "ts";
}

function liveStream(c) {
  return {
    num: c.num,
    name: c.name,
    stream_type: "live",
    stream_id: c.id,
    stream_icon: c.logo,
    epg_channel_id: c.tvgId || null,
    added: "0",
    is_adult: 0,
    category_id: c.categoryId,
    category_ids: [Number(c.categoryId)],
    custom_sid: "",
    tv_archive: 0,
    direct_source: "",
    tv_archive_duration: 0,
  };
}

function userInfo(base, u, p) {
  const url = new URL(base);
  const now = Math.floor(Date.now() / 1000);
  return {
    user_info: {
      username: u,
      password: p,
      message: "",
      auth: 1,
      status: "Active",
      exp_date: null,
      is_trial: "0",
      active_cons: "0",
      created_at: String(now),
      max_connections: "10",
      allowed_output_formats: ["m3u8", "ts"],
    },
    server_info: {
      url: url.hostname,
      port: url.port || (url.protocol === "https:" ? "443" : "80"),
      https_port: "443",
      server_protocol: url.protocol.replace(":", ""),
      rtmp_port: "0",
      timezone: "UTC",
      timestamp_now: now,
      time_now: new Date().toISOString().replace("T", " ").slice(0, 19),
    },
  };
}

export async function handle(request) {
  const url = new URL(request.url);
  // Vercel rewrite passes the original path in __path
  const path = url.searchParams.get("__path") || url.pathname;
  url.searchParams.delete("__path");
  const q = url.searchParams;
  const base = `${url.protocol}//${url.host}`;
  const epg = env("EPG_URL", DEFAULT_EPG);

  try {
    // /live/user/pass/123.ts  or  /user/pass/123
    const sm = path.match(/^\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)(?:\.\w+)?$/);
    if (sm) {
      const [, u, p, id] = sm;
      if (!authOk(decodeURIComponent(u), decodeURIComponent(p))) return new Response("Forbidden", { status: 403 });
      const ch = (await loadPlaylist()).byId.get(Number(id));
      if (!ch) return new Response("Not found", { status: 404 });
      return new Response(null, { status: 302, headers: { location: ch.url, "cache-control": "no-store" } });
    }

    const u = q.get("username") || "", p = q.get("password") || "";

    if (path.endsWith("/xmltv.php")) {
      if (!authOk(u, p)) return new Response("Forbidden", { status: 403 });
      return new Response(null, { status: 302, headers: { location: epg } });
    }

    if (path.endsWith("/get.php")) {
      if (!authOk(u, p)) return new Response("Forbidden", { status: 403 });
      const { channels } = await loadPlaylist();
      const out = [`#EXTM3U url-tvg="${base}/xmltv.php?username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}"`];
      const ext = q.get("output") === "hls" || q.get("output") === "m3u8" ? "m3u8" : null;
      for (const c of channels) {
        out.push(
          `#EXTINF:-1 tvg-id="${c.tvgId}" tvg-name="${c.name}" tvg-logo="${c.logo}" group-title="${c.group}",${c.name}`,
          `${base}/live/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${c.id}.${ext || streamExt(c.url)}`
        );
      }
      return new Response(out.join("\n") + "\n", {
        headers: { "content-type": "audio/x-mpegurl; charset=utf-8", "content-disposition": 'attachment; filename="playlist.m3u"' },
      });
    }

    if (path.endsWith("/player_api.php") || path.endsWith("/panel_api.php")) {
      if (!authOk(u, p)) return json({ user_info: { auth: 0 } });
      const action = q.get("action") || "";
      if (!action) return json(userInfo(base, u, p));
      const pl = await loadPlaylist();
      switch (action) {
        case "get_live_categories":
          return json(pl.categories);
        case "get_live_streams": {
          const cat = q.get("category_id");
          return json(pl.channels.filter((c) => !cat || c.categoryId === cat).map(liveStream));
        }
        case "get_short_epg":
        case "get_simple_data_table":
          return json({ epg_listings: [] }); // players read the full guide from xmltv.php
        case "get_vod_categories":
        case "get_vod_streams":
        case "get_series_categories":
        case "get_series":
          return json([]);
        default:
          return json([]);
      }
    }

    if (path === "/" || path === "") {
      return new Response("Xtream bridge is running.\n", { headers: { "content-type": "text/plain" } });
    }
    return new Response("Not found", { status: 404 });
  } catch (e) {
    return new Response(`Error: ${e.message}\n`, { status: 500 });
  }
}
