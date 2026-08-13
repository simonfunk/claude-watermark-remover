export type FindingKind =
  | "zero-width"
  | "joiner"
  | "bidirectional-control"
  | "unicode-tag"
  | "soft-hyphen"
  | "exotic-space"
  | "line-separator";

export interface TextFinding {
  kind: FindingKind;
  codePoint: string;
  index: number;
  description: string;
}

export interface TextInspection {
  original: string;
  findings: TextFinding[];
  totalFindings: number;
  statisticalWatermark: {
    status: "not-verifiable";
    explanation: string;
  };
}

export interface CleanResult {
  text: string;
  findings: TextFinding[];
  preservedFindings: TextFinding[];
  totalChanges: number;
}

export interface CleanOptions {
  removeJoiners?: boolean;
}

type Rule = {
  kind: FindingKind;
  description: string;
  pattern: RegExp;
  replacement: string;
};

const RULES: Rule[] = [
  {
    kind: "zero-width",
    description: "Zero-width spacing or word-boundary character",
    pattern: /[\u200B\u2060\uFEFF]/gu,
    replacement: "",
  },
  {
    kind: "joiner",
    description: "Language or emoji shaping joiner (preserved by safe cleaning)",
    pattern: /[\u200C\u200D]/gu,
    replacement: "",
  },
  {
    kind: "bidirectional-control",
    description: "Bidirectional text control",
    pattern: /[\u202A-\u202E\u2066-\u2069]/gu,
    replacement: "",
  },
  {
    kind: "unicode-tag",
    description: "Unicode tag character",
    pattern: /[\u{E0001}-\u{E007F}]/gu,
    replacement: "",
  },
  {
    kind: "soft-hyphen",
    description: "Soft hyphen",
    pattern: /\u00AD/gu,
    replacement: "",
  },
  {
    kind: "exotic-space",
    description: "Non-standard spacing character",
    pattern: /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/gu,
    replacement: " ",
  },
  {
    kind: "line-separator",
    description: "Unicode line or paragraph separator",
    pattern: /[\u2028\u2029]/gu,
    replacement: "\n",
  },
];

function codePointLabel(character: string): string {
  const value = character.codePointAt(0);
  return value === undefined ? "U+0000" : `U+${value.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function inspectText(text: string): TextInspection {
  const findings: TextFinding[] = [];

  for (const rule of RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({
        kind: rule.kind,
        codePoint: codePointLabel(match[0]),
        index: match.index,
        description: rule.description,
      });
    }
  }

  findings.sort((left, right) => left.index - right.index);

  return {
    original: text,
    findings,
    totalFindings: findings.length,
    statisticalWatermark: {
      status: "not-verifiable",
      explanation:
        "Statistical model-level watermarks cannot currently be verified because Anthropic has not published a public detector or technical detection specification.",
    },
  };
}

export function cleanText(text: string, options: CleanOptions = {}): CleanResult {
  const inspection = inspectText(text);
  let cleaned = text;

  for (const rule of RULES) {
    if (rule.kind === "joiner" && !options.removeJoiners) continue;
    cleaned = cleaned.replace(rule.pattern, rule.replacement);
  }

  const preservedFindings = inspection.findings.filter(
    (finding) => finding.kind === "joiner" && !options.removeJoiners,
  );

  return {
    text: cleaned,
    findings: inspection.findings,
    preservedFindings,
    totalChanges: inspection.totalFindings - preservedFindings.length,
  };
}
