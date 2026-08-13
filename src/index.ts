export {
  cleanText,
  inspectText,
  type CleanResult,
  type FindingKind,
  type TextFinding,
  type TextInspection,
} from "./text.js";

export {
  buildRewritePrompt,
  comparePreservedFacts,
  extractProtectedFacts,
  type FactComparison,
  type ProtectedFacts,
  type RewritePromptOptions,
} from "./rewrite.js";
