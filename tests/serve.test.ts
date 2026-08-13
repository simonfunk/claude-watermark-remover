import test from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createApp } from "../scripts/serve.mjs";

async function withServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server: Server = createApp();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a network address");
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("serve: / returns web/index.html with an HTML content type", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    const body = await response.text();
    assert.match(body, /<html/i);
  });
});

test("serve: /dist/index.js serves the compiled library as a JS module", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/dist/index.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /javascript/);
    const body = await response.text();
    assert.match(body, /export/);
  });
});

test("serve: unknown paths return 404", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/nope.html`);
    assert.equal(response.status, 404);
  });
});

test("serve: rejects path traversal outside the web root", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/..%2f..%2fpackage.json`);
    assert.equal(response.status, 404);
  });
});

test("serve: sends a restrictive Content-Security-Policy header", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    const csp = response.headers.get("content-security-policy") ?? "";
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /object-src 'none'/);
  });
});

test("serve: rejects non-GET/HEAD methods", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`, { method: "POST" });
    assert.equal(response.status, 405);
  });
});

test("serve: malformed percent-encoding returns 400 without crashing the server", async () => {
  await withServer(async (baseUrl) => {
    const malformed = await fetch(`${baseUrl}/%E0%A4%A`);
    assert.equal(malformed.status, 400);

    const healthy = await fetch(`${baseUrl}/`);
    assert.equal(healthy.status, 200);
  });
});
