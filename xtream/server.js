// Plain Node server (Render, Koyeb, Railway, a VPS, or local test): node server.js
import http from "node:http";
import { handle } from "./xtream.js";

const port = Number(process.env.PORT || 8080);
http
  .createServer(async (req, res) => {
    const proto = req.headers["x-forwarded-proto"] || "http";
    const request = new Request(`${proto}://${req.headers.host}${req.url}`, { method: req.method });
    const r = await handle(request);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(req.method === "HEAD" ? undefined : Buffer.from(await r.arrayBuffer()));
  })
  .listen(port, () => console.log(`Xtream bridge on :${port}`));
