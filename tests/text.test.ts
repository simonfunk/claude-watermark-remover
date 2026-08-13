import test from "node:test";
import assert from "node:assert/strict";
import { inspectText, cleanText } from "../src/index.js";

test("inspectText reports invisible and directional Unicode without changing input", () => {
  const input = "Hello\u200b world\u202e!";
  const report = inspectText(input);

  assert.equal(report.original, input);
  assert.equal(report.totalFindings, 2);
  assert.deepEqual(
    report.findings.map((finding) => finding.kind),
    ["zero-width", "bidirectional-control"],
  );
});

test("cleanText removes invisible carriers and normalizes exotic spaces safely", () => {
  const result = cleanText("Hello\u200b\u00a0world\u00ad");

  assert.equal(result.text, "Hello world");
  assert.equal(result.totalChanges, 3);
});

test("cleanText preserves ordinary newlines, tabs, emoji, and language characters", () => {
  const input = "Grüezi 👋\n日本語\tالعربية";
  assert.equal(cleanText(input).text, input);
});

test("inspectText distinguishes deterministic findings from statistical watermark claims", () => {
  const report = inspectText("Ordinary prose with no unusual Unicode characters.");

  assert.equal(report.totalFindings, 0);
  assert.equal(report.statisticalWatermark.status, "not-verifiable");
  assert.match(report.statisticalWatermark.explanation, /detector/i);
});

test("safe cleaning preserves language and emoji joiners while reporting them", () => {
  const input = "می\u200Cخواهم 👩\u200D💻";
  const report = inspectText(input);
  const result = cleanText(input);

  assert.equal(result.text, input);
  assert.equal(report.findings.filter((finding) => finding.kind === "joiner").length, 2);
  assert.equal(result.totalChanges, 0);
  assert.equal(result.preservedFindings.length, 2);
});

test("aggressive cleaning removes joiners only when explicitly enabled", () => {
  const result = cleanText("A\u200CB\u200DC", { removeJoiners: true });

  assert.equal(result.text, "ABC");
  assert.equal(result.totalChanges, 2);
});
