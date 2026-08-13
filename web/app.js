import { buildReport, cleanText, createOpenAiCompatibleAdapter, inspectProvenance } from "/dist/index.js";
import { renderBeforeHtml } from "/render.js";

const textInput = document.getElementById("text-input");
const fileInput = document.getElementById("file-input");
const findingsSummary = document.getElementById("findings-summary");
const findingsList = document.getElementById("findings-list");
const diffBefore = document.getElementById("diff-before");
const diffAfter = document.getElementById("diff-after");
const copyButton = document.getElementById("copy-cleaned");
const downloadCleanedButton = document.getElementById("download-cleaned");
const downloadReportButton = document.getElementById("download-report");
const actionStatus = document.getElementById("action-status");
const imageInput = document.getElementById("image-input");
const provenanceResult = document.getElementById("provenance-result");

const rewriteEndpointInput = document.getElementById("rewrite-endpoint");
const rewriteModelInput = document.getElementById("rewrite-model");
const rewriteKeyInput = document.getElementById("rewrite-key");
const rewriteTimeoutInput = document.getElementById("rewrite-timeout");
const rewriteDisclosure = document.getElementById("rewrite-disclosure");
const rewriteConsent = document.getElementById("rewrite-consent");
const rewriteForm = document.getElementById("rewrite-form");
const rewriteSendButton = document.getElementById("rewrite-send");
const rewriteCancelButton = document.getElementById("rewrite-cancel");
const rewriteResult = document.getElementById("rewrite-result");

let currentFilename = null;
let lastCleanResult = { text: "", findings: [], preservedFindings: [], totalChanges: 0 };
let activeRewriteController = null;

function getMode() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked && checked.value === "aggressive" ? "aggressive" : "safe";
}

function update() {
  const text = textInput.value;
  const mode = getMode();
  const result = cleanText(text, { removeJoiners: mode === "aggressive" });
  lastCleanResult = result;

  if (text.length === 0) {
    findingsSummary.textContent = "No text provided yet.";
  } else {
    findingsSummary.textContent =
      `${result.findings.length} deterministic finding(s); ` +
      `${result.totalChanges} will change in ${mode} mode; ` +
      `${result.preservedFindings.length} preserved.`;
  }

  findingsList.replaceChildren(
    ...result.findings.map((finding) => {
      const li = document.createElement("li");
      li.textContent = `${finding.kind} at index ${finding.index} (${finding.codePoint}): ${finding.description}`;
      return li;
    }),
  );

  diffBefore.innerHTML = renderBeforeHtml(text, result.findings, result.preservedFindings);
  diffAfter.textContent = result.text;
}

function setActionStatus(message) {
  actionStatus.textContent = message;
  if (message) {
    setTimeout(() => {
      if (actionStatus.textContent === message) actionStatus.textContent = "";
    }, 4000);
  }
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

textInput.addEventListener("input", update);
document.querySelectorAll('input[name="mode"]').forEach((radio) => radio.addEventListener("change", update));

fileInput.addEventListener("change", async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  currentFilename = file.name;
  textInput.value = await file.text();
  update();
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(lastCleanResult.text);
    setActionStatus("Cleaned text copied to clipboard.");
  } catch {
    setActionStatus("Copy failed — your browser may block clipboard access on this page.");
  }
});

downloadCleanedButton.addEventListener("click", () => {
  downloadBlob("cleaned.txt", lastCleanResult.text, "text/plain");
  setActionStatus("Cleaned text downloaded.");
});

downloadReportButton.addEventListener("click", () => {
  const report = buildReport(textInput.value, {
    mode: getMode(),
    ...(currentFilename ? { filename: currentFilename } : {}),
  });
  downloadBlob("watermark-report.json", JSON.stringify(report, null, 2), "application/json");
  setActionStatus("JSON report downloaded.");
});

imageInput.addEventListener("change", async () => {
  const file = imageInput.files && imageInput.files[0];
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = inspectProvenance(bytes, file.name);

  const lines = [
    `File type: ${result.fileType}`,
    `C2PA candidate marker found: ${result.hasC2paCandidate}`,
    `Signature verification: ${result.verification.status} — ${result.verification.explanation}`,
  ];
  if (result.signals.length === 0) {
    lines.push("No provenance markers detected.");
  } else {
    lines.push("Signals:");
    for (const signal of result.signals) {
      lines.push(`  - [${signal.kind}] ${signal.location}: ${signal.description}`);
    }
  }
  provenanceResult.textContent = lines.join("\n");
});

function currentDisclosure() {
  const endpoint = rewriteEndpointInput.value.trim();
  const model = rewriteModelInput.value.trim();
  if (!endpoint || !model) return null;
  return createOpenAiCompatibleAdapter({ endpoint, model }).disclosure;
}

function refreshRewriteControls() {
  const disclosure = currentDisclosure();
  rewriteDisclosure.textContent = disclosure
    ? `Provider: ${disclosure.providerName}\nEndpoint: ${disclosure.endpoint}\nModel: ${disclosure.model}\n` +
      `Sends your text to a third party: ${disclosure.sendsSourceTextToThirdParty}\n${disclosure.retentionNote}`
    : "Enter an endpoint and model to see the disclosure before sending anything.";

  rewriteSendButton.disabled = !(disclosure && rewriteConsent.checked && textInput.value.length > 0);
}

[rewriteEndpointInput, rewriteModelInput].forEach((input) =>
  input.addEventListener("input", refreshRewriteControls),
);
rewriteConsent.addEventListener("change", refreshRewriteControls);
textInput.addEventListener("input", refreshRewriteControls);

rewriteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const endpoint = rewriteEndpointInput.value.trim();
  const model = rewriteModelInput.value.trim();
  const apiKey = rewriteKeyInput.value.trim();
  const timeoutMs = Number(rewriteTimeoutInput.value) || 30_000;
  if (!endpoint || !model || !rewriteConsent.checked) return;

  const adapter = createOpenAiCompatibleAdapter({
    endpoint,
    model,
    timeoutMs,
    ...(apiKey ? { apiKey } : {}),
  });

  const controller = new AbortController();
  activeRewriteController = controller;
  rewriteSendButton.disabled = true;
  rewriteCancelButton.disabled = false;
  rewriteResult.textContent = "Sending…";

  try {
    const outcome = await adapter.rewrite({ text: textInput.value, signal: controller.signal });
    const lines = [
      "Rewrite received.",
      "Deterministic text artifacts cleaned. The text was substantially rewritten. Statistical watermark " +
        "detectability is not verifiable without a public provider detector.",
      `Fact preservation check: ${outcome.verification.ok ? "passed" : "FAILED — review before using this rewrite"}`,
    ];
    if (!outcome.verification.ok) {
      for (const [key, values] of Object.entries(outcome.verification.missing)) {
        if (Array.isArray(values) && values.length > 0) lines.push(`  missing ${key}: ${values.join(", ")}`);
      }
    }
    lines.push("", outcome.rewrittenText);
    rewriteResult.textContent = lines.join("\n");
  } catch (error) {
    rewriteResult.textContent = `Rewrite failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    activeRewriteController = null;
    rewriteCancelButton.disabled = true;
    refreshRewriteControls();
  }
});

rewriteCancelButton.addEventListener("click", () => {
  if (activeRewriteController) activeRewriteController.abort();
});

update();
refreshRewriteControls();
