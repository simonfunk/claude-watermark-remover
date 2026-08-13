#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  buildRewritePrompt,
  cleanText,
  comparePreservedFacts,
  inspectText,
  type RewritePromptOptions,
} from "./index.js";

const USAGE = `Usage:
  claude-watermark-remover inspect [file] [--json]
  claude-watermark-remover clean [file] [--json] [--aggressive]
  claude-watermark-remover verify <source-file> <rewritten-file> [--json]
  claude-watermark-remover prompt [file] [--strength light|strong] [--locale locale] [--brand-voice text]

If no file is supplied, input is read from stdin.

Important: deterministic Unicode findings can be inspected and cleaned. Statistical
model-level watermarks cannot currently be detected or removal-verified without a
public detector from the model provider.`;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function inputPath(args: string[]): string | undefined {
  const valueOptions = new Set(["--strength", "--locale", "--brand-voice"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (valueOptions.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith("--")) return arg;
  }
  return undefined;
}

async function getInput(args: string[]): Promise<string> {
  const path = inputPath(args);
  return path ? readFile(path, "utf8") : readStdin();
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    return;
  }

  if (!["inspect", "clean", "verify", "prompt"].includes(command)) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (command === "verify") {
    const paths = args.filter((arg) => !arg.startsWith("--"));
    if (paths.length !== 2) {
      throw new Error("verify requires <source-file> and <rewritten-file>");
    }
    const [sourcePath, rewrittenPath] = paths;
    if (!sourcePath || !rewrittenPath) throw new Error("verify requires two files");
    const [source, rewritten] = await Promise.all([
      readFile(sourcePath, "utf8"),
      readFile(rewrittenPath, "utf8"),
    ]);
    const report = comparePreservedFacts(source, rewritten);
    if (args.includes("--json")) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(
        report.ok
          ? "Verification passed: protected facts and document structure were preserved.\n"
          : "Verification failed: protected facts or document structure changed.\n",
      );
    }
    if (!report.ok) process.exitCode = 2;
    return;
  }

  const text = await getInput(args);

  if (command === "inspect") {
    const report = inspectText(text);
    if (args.includes("--json")) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    process.stdout.write(
      `${report.totalFindings} deterministic finding(s)\n${report.statisticalWatermark.explanation}\n`,
    );
    return;
  }

  if (command === "clean") {
    const result = cleanText(text, { removeJoiners: args.includes("--aggressive") });
    if (args.includes("--json")) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write(result.text);
    return;
  }

  const rawStrength = option(args, "--strength");
  if (rawStrength && rawStrength !== "light" && rawStrength !== "strong") {
    throw new Error("--strength must be light or strong");
  }
  let strength: RewritePromptOptions["strength"];
  if (rawStrength === "light" || rawStrength === "strong") {
    strength = rawStrength;
  }

  const promptOptions: RewritePromptOptions = {};
  if (strength) promptOptions.strength = strength;
  const locale = option(args, "--locale");
  if (locale) promptOptions.locale = locale;
  const brandVoice = option(args, "--brand-voice");
  if (brandVoice) promptOptions.brandVoice = brandVoice;

  const prompt = buildRewritePrompt(text, promptOptions);
  process.stdout.write(`${JSON.stringify(prompt, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
