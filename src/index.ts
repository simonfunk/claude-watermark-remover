export {
  cleanText,
  inspectText,
  type CleanResult,
  type CleanOptions,
  type FindingKind,
  type TextFinding,
  type TextInspection,
} from "./text.js";

export {
  buildRewritePrompt,
  comparePreservedFacts,
  extractProtectedFacts,
  type FactComparison,
  type DocumentStructure,
  type ProtectedFacts,
  type RewritePromptOptions,
} from "./rewrite.js";

export {
  buildReport,
  REPORT_SCHEMA_VERSION,
  TOOL_NAME,
  TOOL_VERSION,
  type BuildReportOptions,
  type WatermarkReport,
} from "./report.js";

export {
  createOpenAiCompatibleAdapter,
  RewriteAbortedError,
  RewriteInputTooLargeError,
  RewriteProviderError,
  RewriteResponseError,
  RewriteTimeoutError,
  type RewriteOutcome,
  type RewriteProvider,
  type RewriteProviderConfig,
  type RewriteProviderDisclosure,
  type RewriteRequest,
} from "./provider.js";

export {
  inspectProvenance,
  type ProvenanceFileType,
  type ProvenanceInspection,
  type ProvenanceSignal,
  type ProvenanceSignalKind,
} from "./c2pa.js";
