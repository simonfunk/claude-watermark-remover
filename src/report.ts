import { cleanText, type CleanOptions, type TextFinding } from "./text.js";

export const REPORT_SCHEMA_VERSION = "1.0.0";
export const TOOL_NAME = "claude-watermark-remover";
export const TOOL_VERSION = "0.1.0";

export interface BuildReportOptions {
  mode?: "safe" | "aggressive";
  filename?: string;
}

export interface WatermarkReport {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  generatedAt: string;
  tool: { name: string; version: string };
  source: { filename: string | null; characterCount: number };
  mode: "safe" | "aggressive";
  findings: TextFinding[];
  totalFindings: number;
  totalChanges: number;
  preservedFindingCount: number;
  statisticalWatermark: { status: "not-verifiable"; explanation: string };
  cleanedText: string;
}

export function buildReport(text: string, options: BuildReportOptions = {}): WatermarkReport {
  const mode = options.mode ?? "safe";
  const cleanOptions: CleanOptions = { removeJoiners: mode === "aggressive" };
  const result = cleanText(text, cleanOptions);

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    source: {
      filename: options.filename ?? null,
      characterCount: [...text].length,
    },
    mode,
    findings: result.findings,
    totalFindings: result.findings.length,
    totalChanges: result.totalChanges,
    preservedFindingCount: result.preservedFindings.length,
    statisticalWatermark: {
      status: "not-verifiable",
      explanation:
        "Statistical model-level watermarks cannot currently be verified because Anthropic has not published a public detector or technical detection specification.",
    },
    cleanedText: result.text,
  };
}
