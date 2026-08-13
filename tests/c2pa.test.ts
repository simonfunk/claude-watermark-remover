import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { inspectProvenance } from "../src/index.js";

const FIXTURES = path.join(process.cwd(), "tests", "fixtures", "images");

async function fixture(name: string): Promise<Uint8Array> {
  return readFile(path.join(FIXTURES, name));
}

test("inspectProvenance detects a C2PA JUMBF candidate and XMP in a PNG", async () => {
  const result = inspectProvenance(await fixture("c2pa.png"), "c2pa.png");

  assert.equal(result.fileType, "png");
  assert.equal(result.hasC2paCandidate, true);
  assert.ok(result.signals.some((s) => s.kind === "c2pa-jumbf"));
  assert.ok(result.signals.some((s) => s.kind === "xmp"));
});

test("inspectProvenance reports no signals for a plain PNG", async () => {
  const result = inspectProvenance(await fixture("clean.png"), "clean.png");

  assert.equal(result.fileType, "png");
  assert.equal(result.hasC2paCandidate, false);
  assert.deepEqual(result.signals, []);
});

test("inspectProvenance detects a C2PA APP11 candidate, EXIF, and XMP in a JPEG", async () => {
  const result = inspectProvenance(await fixture("c2pa.jpg"), "c2pa.jpg");

  assert.equal(result.fileType, "jpeg");
  assert.equal(result.hasC2paCandidate, true);
  assert.ok(result.signals.some((s) => s.kind === "c2pa-jumbf"));
  assert.ok(result.signals.some((s) => s.kind === "xmp"));
  assert.ok(result.signals.some((s) => s.kind === "exif"));
});

test("inspectProvenance detects EXIF without claiming C2PA for an EXIF-only JPEG", async () => {
  const result = inspectProvenance(await fixture("exif-only.jpg"), "exif-only.jpg");

  assert.equal(result.hasC2paCandidate, false);
  assert.ok(result.signals.some((s) => s.kind === "exif"));
  assert.equal(result.signals.some((s) => s.kind === "c2pa-jumbf"), false);
});

test("inspectProvenance reports no signals for a plain JPEG", async () => {
  const result = inspectProvenance(await fixture("clean.jpg"), "clean.jpg");

  assert.equal(result.fileType, "jpeg");
  assert.deepEqual(result.signals, []);
});

test("inspectProvenance detects a c2pa:manifest element and XMP metadata in SVG text", async () => {
  const result = inspectProvenance(await fixture("c2pa.svg"), "c2pa.svg");

  assert.equal(result.fileType, "svg");
  assert.equal(result.hasC2paCandidate, true);
  assert.ok(result.signals.some((s) => s.kind === "c2pa-jumbf"));
  assert.ok(result.signals.some((s) => s.kind === "xmp"));
});

test("inspectProvenance reports no signals for a plain SVG", async () => {
  const result = inspectProvenance(await fixture("clean.svg"), "clean.svg");

  assert.equal(result.fileType, "svg");
  assert.equal(result.hasC2paCandidate, false);
  assert.deepEqual(result.signals, []);
});

test("inspectProvenance never claims cryptographic authenticity", async () => {
  const result = inspectProvenance(await fixture("c2pa.png"), "c2pa.png");

  assert.equal(result.verification.status, "not-performed");
  assert.match(result.verification.explanation, /not.*verif|cannot.*verif/i);
  assert.doesNotMatch(result.verification.explanation, /authentic\b/i);
});

test("inspectProvenance labels unrecognized bytes as unknown rather than guessing", () => {
  const result = inspectProvenance(new TextEncoder().encode("not an image"), "mystery.bin");

  assert.equal(result.fileType, "unknown");
  assert.deepEqual(result.signals, []);
  assert.equal(result.hasC2paCandidate, false);
});

test("inspectProvenance module exposes no removal or stripping function", async () => {
  const c2paModule = await import("../src/c2pa.js");
  const exportNames = Object.keys(c2paModule);
  assert.ok(!exportNames.some((name) => /remove|strip|delete/i.test(name)));
});

test("inspectProvenance does not mistake an arbitrary JPEG APP11 segment for JUMBF", () => {
  const payload = Buffer.from("not-jumbf");
  const length = payload.length + 2;
  const bytes = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xeb, (length >> 8) & 0xff, length & 0xff, ...payload,
    0xff, 0xd9,
  ]);

  const result = inspectProvenance(bytes, "ordinary-app11.jpg");
  assert.equal(result.hasC2paCandidate, false);
  assert.deepEqual(result.signals, []);
});
