import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("published package includes every runtime file required by npm start", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    files: string[];
    scripts: Record<string, string>;
  };

  assert.equal(packageJson.scripts.start, "npm run serve", "published start command must not require unpackaged source/build tools");
  assert.ok(packageJson.files.includes("web"), "web UI must be published");
  assert.ok(packageJson.files.includes("scripts/serve.mjs"), "runtime server must be published");
});