import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildReport } from "../src/index.js";

async function loadValidator() {
  const schemaText = await readFile(new URL("../schema/report.schema.json", import.meta.url), "utf8");
  const schema = JSON.parse(schemaText);
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

test("buildReport produces a report that satisfies the checked-in JSON Schema", async () => {
  const validate = await loadValidator();
  const report = buildReport("Hello​ world­", { mode: "safe" });

  const valid = validate(report);
  assert.equal(valid, true, JSON.stringify(validate.errors));
});

test("buildReport includes schema version, tool metadata, and honest watermark disclaimer", () => {
  const report = buildReport("plain text", { mode: "safe" });

  assert.equal(report.schemaVersion, "1.0.0");
  assert.equal(typeof report.tool.name, "string");
  assert.equal(typeof report.tool.version, "string");
  assert.equal(report.statisticalWatermark.status, "not-verifiable");
  assert.match(report.statisticalWatermark.explanation, /detector/i);
});

test("buildReport records mode, findings, cleaned text, and optional filename", () => {
  const report = buildReport("A‌B‍C", { mode: "aggressive", filename: "draft.md" });

  assert.equal(report.mode, "aggressive");
  assert.equal(report.source.filename, "draft.md");
  assert.equal(report.source.characterCount, 5);
  assert.equal(report.cleanedText, "ABC");
  assert.equal(report.totalChanges, 2);
  assert.equal(report.findings.length, 2);
});

test("buildReport defaults filename to null and mode to safe", () => {
  const report = buildReport("no artifacts here");

  assert.equal(report.source.filename, null);
  assert.equal(report.mode, "safe");
});

test("buildReport rejects an unrelated shape under the schema", async () => {
  const validate = await loadValidator();
  const valid = validate({ nonsense: true });
  assert.equal(valid, false);
});

test("report tool version matches package metadata", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  assert.equal(buildReport("text").tool.version, packageJson.version);
});
