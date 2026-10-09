#!/usr/bin/env node
/**
 * Serve the BUILT app locally the way Netlify does: static files from dist/
 * first (the publish dir), everything else through the Netlify function that
 * Nitro emitted at .netlify/functions-internal/server.
 *
 * Run `npm run build` first. Unlike `vite preview`, this passes the function's
 * Response headers through intact (multiple Set-Cookie headers included).
 *
 *   PORT=8082 node scripts/serve-built.mjs
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const dist = join(root, "dist");
const fnPath = join(root, ".netlify/functions-internal/server/server.mjs");
const port = Number(process.env.PORT ?? 8082);

const TYPES = {
  ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2", ".ico": "image/x-icon",
};

const { default: handler } = await import(pathToFileURL(fnPath).href);

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    const file = join(dist, rel);
    if (rel !== "/" && file.startsWith(dist) && existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      createReadStream(file).pipe(res);
      return;
    }
    const hasBody = !["GET", "HEAD"].includes(req.method ?? "GET");
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: hasBody ? "half" : undefined,
    });
    const response = await handler(request, {});
    const headers = {};
    response.headers.forEach((v, k) => { if (k !== "set-cookie") headers[k] = v; });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) headers["set-cookie"] = cookies;
    res.writeHead(response.status, headers);
    if (response.body) Readable.fromWeb(response.body).pipe(res);
    else res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end("server error");
  }
}).listen(port, "127.0.0.1", () => console.log(`serving built app on http://127.0.0.1:${port}`));
