#!/usr/bin/env node
// Zero-dependency static file server for the local browser UI.
// Serves web/ at "/" and the compiled library at "/dist/*" so the page can
// import the built package directly as native ES modules, entirely offline.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const webRoot = path.join(root, "web");
const distRoot = path.join(root, "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src *; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function resolveSafe(base, requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const normalized = path.normalize(decoded).replace(/^([/\\]|\.\.[/\\])+/, "");
  const full = path.join(base, normalized);
  const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
  if (full !== base && !full.startsWith(baseWithSep)) return null;
  return full;
}

async function serveFile(res, filePath) {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    return false;
  }
  if (info.isDirectory()) return false;
  const body = await readFile(filePath);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream",
    "content-length": body.length,
  });
  res.end(body);
  return true;
}

export function createApp() {
  return createServer(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, SECURITY_HEADERS).end("Method not allowed");
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    let pathname = url.pathname;
    if (pathname === "/") pathname = "/index.html";

    const isDist = pathname.startsWith("/dist/");
    const base = isDist ? distRoot : webRoot;
    const relative = isDist ? pathname.slice("/dist".length) : pathname;
    let target;
    try {
      target = resolveSafe(base, relative);
    } catch (error) {
      if (error instanceof URIError) {
        res.writeHead(400, { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" }).end("Bad request");
        return;
      }
      throw error;
    }

    if (!target || !(await serveFile(res, target))) {
      res.writeHead(404, { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" }).end("Not found");
    }
  });
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.PORT ?? 4300);
  const server = createApp();
  server.listen(port, () => {
    process.stdout.write(`Claude Watermark Remover UI: http://localhost:${port}/\n`);
  });
}
