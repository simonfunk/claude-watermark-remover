import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function runCli(args: string[], input = "") {
  return spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    input,
    encoding: "utf8",
  });
}

test("CLI inspect reads stdin and returns structured JSON", () => {
  const result = runCli(["inspect", "--json"], "Hello\u200b world");

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as { totalFindings: number };
  assert.equal(report.totalFindings, 1);
});

test("CLI clean writes cleaned text to stdout", () => {
  const result = runCli(["clean"], "Hello\u00a0world\u00ad");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "Hello world");
});

test("CLI aggressive cleaning removes shaping joiners only when requested", () => {
  const result = runCli(["clean", "--aggressive"], "A\u200CB\u200DC");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "ABC");
});

test("CLI prompt emits a safe rewrite request as JSON", () => {
  const result = runCli(["prompt", "--strength", "strong", "--locale", "de"], "Ein Text mit 42 Fakten.");

  assert.equal(result.status, 0, result.stderr);
  const prompt = JSON.parse(result.stdout) as { system: string; user: string };
  assert.match(prompt.system, /Write in de/);
  assert.match(prompt.user, /42/);
});

test("CLI rejects unknown commands with a non-zero exit", () => {
  const result = runCli(["unknown"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test("CLI verify compares a source and rewrite end to end", () => {
  const result = runCli([
    "verify",
    "tests/fixtures/source.md",
    "tests/fixtures/rewrite.md",
    "--json",
  ]);

  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout) as {
    ok: boolean;
    missing: { numbers: string[] };
  };
  assert.equal(report.ok, false);
  assert.deepEqual(report.missing.numbers, ["42"]);
});
