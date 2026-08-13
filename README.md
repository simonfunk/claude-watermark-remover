# Claude Watermark Remover

A privacy-first toolkit for inspecting and cleaning deterministic text artifacts, preparing substantial editorial rewrites, and checking that important facts survive a rewrite.

It was built in response to the August 2026 discussion around model-level text watermarks. The project deliberately separates what software can verify today from what it cannot.

## What it can verify

- zero-width characters and joiners
- bidirectional text controls
- Unicode tag characters
- soft hyphens
- exotic spaces and Unicode line separators
- whether numbers, URLs, email addresses, and code-like identifiers survive a rewrite

## What it cannot verify

Claude Watermark Remover inspects and removes detectable hidden Unicode artifacts locally and provides a controlled rewrite workflow for AI-generated text.

It does **not** claim to detect or guarantee removal of Claude's undisclosed statistical model-level watermark. Anthropic has described embedded text watermarks but has not published a public detector or complete technical detection specification. A substantial rewrite may change a statistical signal, but no result from this project certifies detector evasion.

This is an editorial hygiene tool—not an authorship detector, cheating tool, or provenance guarantee.

## Install

```bash
git clone https://github.com/simonfunk/claude-watermark-remover.git
cd claude-watermark-remover
npm install --include=dev
npm run check
```

Node.js 20 or newer is required.

## CLI

Read from stdin:

```bash
printf 'Hello\u200b world' | npm run dev -- inspect --json
printf 'Hello\u00a0world\u00ad' | npm run dev -- clean
```

Read from a file:

```bash
npm run dev -- inspect draft.md --json
npm run dev -- clean draft.md
```

Create a safe rewrite request for an LLM of your choice:

```bash
npm run dev -- prompt draft.md \
  --strength strong \
  --locale en \
  --brand-voice 'clear, direct, evidence-led'
```

`prompt` prints JSON containing separate `system` and `user` messages. It does not send the source text anywhere.

After an external rewrite, the library API can verify preserved facts:

```ts
import { comparePreservedFacts } from "claude-watermark-remover";

const result = comparePreservedFacts(source, rewritten);
if (!result.ok) {
  console.error(result.missing);
}
```

## Library API

```ts
import {
  inspectText,
  cleanText,
  buildRewritePrompt,
  extractProtectedFacts,
  comparePreservedFacts,
} from "claude-watermark-remover";
```

### Honest result language

Recommended:

> Deterministic text artifacts cleaned. The text was substantially rewritten. Statistical watermark detectability is not verifiable without a public provider detector.

Do not say:

> Claude watermark successfully removed.

## Privacy and security

- `inspect`, `clean`, and fact-preservation checks run locally.
- `prompt` only generates a request locally; it does not call an API.
- No telemetry, analytics, accounts, or storage are included.
- Source text inside the generated prompt is explicitly treated as untrusted data to reduce prompt-injection risk.
- Never paste confidential text into a third-party rewrite model unless its data handling is acceptable for that content.

See [SECURITY.md](SECURITY.md) for reporting and deployment guidance.

## Development

```bash
npm install --include=dev
npm test
npm run build
npm run check
```

The test suite covers Unicode inspection/cleaning, multilingual preservation, rewrite-prompt boundaries, fact extraction/comparison, and CLI behavior.

## Roadmap

- browser demo with fully local deterministic inspection
- richer protected-fact extraction
- optional provider adapters with explicit retention disclosures
- C2PA inspection without destructive removal defaults
- machine-readable JSON Schema for reports

## Responsible use

Use this project only with content you own or are authorized to process. Do not use it to misrepresent authorship, evade academic or workplace policies, or remove provenance signals where disclosure is legally or contractually required.

Not affiliated with or endorsed by Anthropic. Claude is a trademark of Anthropic PBC.

## License

MIT © 2026 Simon Funk
