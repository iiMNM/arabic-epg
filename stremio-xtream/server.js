// Plain Node server (Render, Koyeb, Railway, a VPS, or local test): node server.js
import http from "node:http";
import { handle } from "./addon.js";
import { CONFIGURE_HTML } from "./configure.js";

const port = Number(process.env.PORT || 7000);
http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const proto = req.headers["x-forwarded-proto"] || "http";
    const request = new Request(`${proto}://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const r = await handle(request, CONFIGURE_HTML);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(req.method === "HEAD" ? undefined : Buffer.from(await r.arrayBuffer()));
  })
  .listen(port, () => console.log(`Stremio Xtream addon on http://localhost:${port}/configure`));
