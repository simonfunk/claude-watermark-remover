import test from "node:test";
import assert from "node:assert/strict";
import { cleanText } from "../src/index.js";
import { classifyFinding, escapeHtml, renderBeforeHtml } from "../web/render.js";

test("escapeHtml escapes the five reserved HTML characters", () => {
  assert.equal(escapeHtml(`<b>"a" & 'b'</b>`), "&lt;b&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/b&gt;");
});

test("classifyFinding marks joiners as preserved only when they were not changed", () => {
  const input = "می‌خواهم";
  const result = cleanText(input);
  const joinerFinding = result.findings.find((f) => f.kind === "joiner")!;

  assert.equal(classifyFinding(joinerFinding, result.preservedFindings), "preserved");
});

test("classifyFinding marks exotic-space and line-separator findings as normalized", () => {
  const result = cleanText("A B C");
  const spaceFinding = result.findings.find((f) => f.kind === "exotic-space")!;
  const separatorFinding = result.findings.find((f) => f.kind === "line-separator")!;

  assert.equal(classifyFinding(spaceFinding, result.preservedFindings), "normalized");
  assert.equal(classifyFinding(separatorFinding, result.preservedFindings), "normalized");
});

test("classifyFinding marks deleted carriers (e.g. zero-width) as removed", () => {
  const result = cleanText("Hello​world");
  const finding = result.findings.find((f) => f.kind === "zero-width")!;

  assert.equal(classifyFinding(finding, result.preservedFindings), "removed");
});

test("renderBeforeHtml wraps each finding's character in a marked span and escapes surrounding text", () => {
  const input = "<A>​B";
  const result = cleanText(input);

  const html = renderBeforeHtml(input, result.findings, result.preservedFindings);

  assert.equal(html, `&lt;A&gt;<mark class="mark-removed" title="Zero-width spacing or word-boundary character (removed)">​</mark>B`);
});

test("renderBeforeHtml correctly indexes astral (surrogate-pair) code points like Unicode tag characters", () => {
  const tagChar = String.fromCodePoint(0xe0001);
  const input = `x${tagChar}y`;
  const result = cleanText(input);

  const html = renderBeforeHtml(input, result.findings, result.preservedFindings);

  assert.equal(html, `x<mark class="mark-removed" title="Unicode tag character (removed)">${tagChar}</mark>y`);
});

test("renderBeforeHtml returns escaped plain text when there are no findings", () => {
  const html = renderBeforeHtml("plain <text>", [], []);
  assert.equal(html, "plain &lt;text&gt;");
});
