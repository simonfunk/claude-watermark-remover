// Pure, DOM-free rendering helpers for the local browser UI. Kept dependency-free
// and unit-testable in Node; app.js wires these strings into the page.

const NORMALIZED_KINDS = new Set(["exotic-space", "line-separator"]);

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

export function classifyFinding(finding, preservedFindings) {
  const isPreserved = preservedFindings.some(
    (preserved) => preserved.index === finding.index && preserved.kind === finding.kind,
  );
  if (isPreserved) return "preserved";
  if (NORMALIZED_KINDS.has(finding.kind)) return "normalized";
  return "removed";
}

/**
 * Renders the original text as escaped HTML with each finding's character
 * wrapped in a <mark> classed by whether cleaning removed, normalized, or
 * (in safe mode) preserved it. Indexes correctly across surrogate pairs.
 */
export function renderBeforeHtml(original, findings, preservedFindings) {
  const sorted = [...findings].sort((a, b) => a.index - b.index);
  let html = "";
  let cursor = 0;

  for (const finding of sorted) {
    if (finding.index < cursor) continue;
    html += escapeHtml(original.slice(cursor, finding.index));

    const codePoint = original.codePointAt(finding.index);
    const char = codePoint === undefined ? "" : String.fromCodePoint(codePoint);
    const status = classifyFinding(finding, preservedFindings);
    html += `<mark class="mark-${status}" title="${escapeHtml(finding.description)} (${status})">${escapeHtml(char)}</mark>`;

    cursor = finding.index + char.length;
  }

  html += escapeHtml(original.slice(cursor));
  return html;
}
