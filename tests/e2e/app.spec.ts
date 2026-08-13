import { test, expect } from "@playwright/test";
import path from "node:path";

const FIXTURES = path.join(process.cwd(), "tests", "fixtures", "images");

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test("boots the production build without console or page errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Claude Watermark Remover" })).toBeVisible();

  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});

test("pasting text inspects it locally and shows findings without a page reload", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("text-input").fill("Hello​ world");

  await expect(page.getByTestId("findings-summary")).toContainText("1 deterministic finding");
  await expect(page.getByTestId("diff-before").locator("mark.mark-removed")).toHaveCount(1);
  await expect(page.getByTestId("diff-after")).toHaveText("Hello world");
});

test("safe mode preserves joiners; aggressive mode removes them", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("text-input").fill("A‌B‍C");

  await expect(page.getByTestId("diff-after")).toHaveText("A‌B‍C");
  await expect(page.getByTestId("diff-before").locator("mark.mark-preserved")).toHaveCount(2);

  await page.getByTestId("mode-aggressive").check();

  await expect(page.getByTestId("diff-after")).toHaveText("ABC");
  await expect(page.getByTestId("diff-before").locator("mark.mark-removed")).toHaveCount(2);
});

test("uploading a text file populates the editor and updates findings", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles({
    name: "draft.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Soft­hyphen"),
  });

  await expect(page.getByTestId("text-input")).toHaveValue("Soft­hyphen");
  await expect(page.getByTestId("findings-summary")).toContainText("1 deterministic finding");
});

test("copy cleaned text writes the cleaned result to the clipboard", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("text-input").fill("Hello​ world");
  await page.getByTestId("copy-cleaned").click();

  await expect(page.getByTestId("action-status")).toContainText("copied");
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toBe("Hello world");
});

test("downloads cleaned text and a schema-shaped JSON report", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("text-input").fill("Hello​ world");

  const [cleanedDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download-cleaned").click(),
  ]);
  expect(cleanedDownload.suggestedFilename()).toBe("cleaned.txt");
  const cleanedPath = await cleanedDownload.path();
  expect(cleanedPath).toBeTruthy();

  const [reportDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download-report").click(),
  ]);
  expect(reportDownload.suggestedFilename()).toBe("watermark-report.json");
  const reportPath = await reportDownload.path();
  const fs = await import("node:fs/promises");
  const report = JSON.parse(await fs.readFile(reportPath as string, "utf8"));
  expect(report.schemaVersion).toBe("1.0.0");
  expect(report.cleanedText).toBe("Hello world");
  expect(report.statisticalWatermark.status).toBe("not-verifiable");
});

test("image provenance panel inspects a C2PA-marked PNG honestly, without modifying it", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("image-input").setInputFiles(path.join(FIXTURES, "c2pa.png"));

  const result = page.getByTestId("provenance-result");
  await expect(result).toContainText("File type: png");
  await expect(result).toContainText("C2PA candidate marker found: true");
  await expect(result).toContainText("not-performed");
});

test("image provenance panel reports no signals for a clean image", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("image-input").setInputFiles(path.join(FIXTURES, "clean.jpg"));

  const result = page.getByTestId("provenance-result");
  await expect(result).toContainText("File type: jpeg");
  await expect(result).toContainText("C2PA candidate marker found: false");
  await expect(result).toContainText("No provenance markers detected.");
});

test("rewrite panel discloses the provider before enabling send, requires explicit consent, and never hits a live network endpoint", async ({
  page,
}) => {
  let requestCount = 0;
  await page.route("https://example.test/v1/chat/completions", async (route) => {
    requestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: "Rewritten, but the contact email was dropped." } }] }),
    });
  });

  await page.goto("/");
  await page.getByTestId("text-input").fill("Please email ops@example.com for details.");
  await page.locator("#rewrite-panel summary").click();

  const sendButton = page.getByTestId("rewrite-send");
  await page.getByTestId("rewrite-endpoint").fill("https://example.test/v1/chat/completions");
  await page.getByTestId("rewrite-model").fill("gpt-test");

  await expect(page.getByTestId("rewrite-disclosure")).toContainText("Sends your text to a third party: true");
  await expect(sendButton).toBeDisabled();

  await page.getByTestId("rewrite-consent").check();
  await expect(sendButton).toBeEnabled();

  await sendButton.click();
  await expect(page.getByTestId("rewrite-result")).toContainText("Rewritten, but the contact email was dropped.");
  await expect(page.getByTestId("rewrite-result")).toContainText("FAILED");
  await expect(page.getByTestId("rewrite-result")).toContainText("not verifiable");

  expect(requestCount).toBe(1);
});
