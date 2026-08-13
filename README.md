# Claude Watermark Remover

A privacy-first toolkit for inspecting and cleaning deterministic text artifacts, preparing substantial editorial rewrites, and checking that important facts survive a rewrite.

It was built in response to the August 2026 discussion around model-level text watermarks. The project deliberately separates what software can verify today from what it cannot.

## What it can verify

- zero-width characters and joiners
- bidirectional text controls
- Unicode tag characters
- soft hyphens
- exotic spaces and Unicode line separators
- whether numbers, URLs, email addresses, code-like identifiers, exact quotations, and Markdown links survive a rewrite
- whether Markdown headings, list items, and fenced code blocks keep the same structure

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

## Browser UI

A standalone, dependency-light local UI is served directly from this repository — no bundler, no
external CDN, no account.

```bash
npm start
```

This builds the library and serves `web/` at `http://localhost:4300/`. Inspecting, cleaning, and
the before/after diff all run **entirely in your browser tab**; nothing about your text is sent
anywhere unless you explicitly open the optional rewrite panel and submit a request (see below).

Features:

- paste text or upload a `.txt`/`.md` file
- safe (default) and aggressive cleaning modes, matching the CLI/library behavior
- a visible findings list (kind, code point, index, description) and a color-coded before/after
  diff showing which characters were removed, normalized, or preserved
- copy the cleaned text to the clipboard, or download it as `.txt`
- download a machine-readable JSON report (see below)
- an inspect-only image provenance panel for PNG/JPEG/SVG (see C2PA section below)
- an optional, off-by-default panel to send text to a self-hosted or third-party rewrite provider,
  with an explicit disclosure banner and a required consent checkbox before anything is sent

Run `npm run serve` instead of `npm start` to serve an existing `dist/` build without rebuilding.

## JSON reports

`buildReport()` (library) and `claude-watermark-remover report` (CLI) produce a machine-readable
report describing one inspection/clean pass: findings, counts, the cleaned text, and the honest
statistical-watermark disclaimer. The browser UI's "Download JSON report" button produces the same
shape.

The report format is versioned and checked in as a JSON Schema at
[`schema/report.schema.json`](schema/report.schema.json) (draft 2020-12). `tests/report.test.ts`
validates real report output against it with [ajv](https://ajv.js.org/), so the schema and the
implementation cannot silently drift apart.

```bash
npm run dev -- report draft.md --aggressive > report.json
```

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
npm run dev -- clean draft.md --aggressive # also remove ZWNJ/ZWJ; may alter language or emoji shaping
```

Create a safe rewrite request for an LLM of your choice:

```bash
npm run dev -- prompt draft.md \
  --strength strong \
  --locale en \
  --brand-voice 'clear, direct, evidence-led'
```

`prompt` prints JSON containing separate `system` and `user` messages. It does not send the source text anywhere.

Safe cleaning preserves ZWNJ/ZWJ characters because they can be meaningful in Persian, Arabic-derived scripts, Indic text, and emoji sequences. `--aggressive` removes them only when explicitly requested.

Compare an original file with a rewritten version:

```bash
npm run dev -- verify original.md rewritten.md --json
```

`verify` exits with status `0` when protected facts and Markdown structure are preserved, and status `2` when something changed or disappeared.

Generate a JSON report (see [JSON reports](#json-reports)):

```bash
npm run dev -- report draft.md
npm run dev -- report draft.md --aggressive
```

Inspect an image for embedded provenance markers (see [Image provenance](#image-provenance-c2pa)):

```bash
npm run dev -- provenance photo.jpg --json
```

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
  buildReport,
  createOpenAiCompatibleAdapter,
  inspectProvenance,
} from "claude-watermark-remover";
```

## Rewrite provider adapters

Substantial rewriting can optionally be delegated to an LLM through a small, pluggable adapter
architecture (`RewriteProvider` in [`src/provider.ts`](src/provider.ts)) instead of the
copy-a-prompt-yourself workflow above. This is entirely opt-in — no core feature (inspect, clean,
report, C2PA inspection) ever needs it or any credentials.

```ts
import { createOpenAiCompatibleAdapter } from "claude-watermark-remover";

const adapter = createOpenAiCompatibleAdapter({
  endpoint: "http://localhost:11434/v1/chat/completions", // any OpenAI-compatible server, local or remote
  model: "llama3.1",
  // apiKey is optional — never required for local/self-hosted servers
  timeoutMs: 30_000, // default; also enforced via AbortSignal
  maxInputCharacters: 20_000, // default input size limit
});

const controller = new AbortController();
const outcome = await adapter.rewrite({
  text: source,
  signal: controller.signal, // caller-controlled cancellation, independent of the timeout
});

console.log(outcome.verification.ok); // whether protected facts/structure survived the rewrite
```

Design points, all covered by `tests/provider.test.ts` with a mocked `fetch` (no live network calls
run in tests, ever):

- **No required credentials.** `apiKey` is optional and omitted entirely from the request when not set.
- **No source-text logging.** The adapter never calls `console.*` with request/response content; errors carry only generic, text-free messages.
- **Explicit disclosure.** `adapter.disclosure` exposes `{ providerName, endpoint, model, sendsSourceTextToThirdParty: true, retentionNote }` so callers (including the browser UI) can show the user exactly where their text is going before sending it.
- **Timeouts and cancellation.** A built-in timeout (default 30s) and an optional caller-supplied `AbortSignal` are combined; either firing aborts the in-flight request with a distinct, catchable error (`RewriteTimeoutError` vs. `RewriteAbortedError`).
- **Input limits.** Requests over `maxInputCharacters` are rejected before any network call (`RewriteInputTooLargeError`).
- **Post-rewrite preservation verification.** Every successful call runs `comparePreservedFacts()` against the response and returns it as `outcome.verification`, so a rewrite that drops a number, URL, quotation, or Markdown link is flagged automatically.

The browser UI's rewrite panel is collapsed by default, shows the same disclosure text, and
requires an explicit consent checkbox before the "Send" button is enabled.

## Image provenance (C2PA)

`inspectProvenance()` (library) and `claude-watermark-remover provenance` (CLI) do a byte-level,
**inspect-only** scan of a PNG, JPEG, or SVG file for provenance markers: a C2PA/JUMBF box (PNG's
private `caBX` chunk, JPEG's `APP11` segments, or an SVG `c2pa:` namespace/element), embedded XMP
metadata, EXIF metadata, and Photoshop IPTC metadata.

```ts
import { inspectProvenance } from "claude-watermark-remover";
import { readFile } from "node:fs/promises";

const bytes = await readFile("photo.jpg");
const result = inspectProvenance(bytes, "photo.jpg");
console.log(result.hasC2paCandidate, result.signals, result.verification);
```

This module intentionally does **not** claim to verify a C2PA manifest's cryptographic claim
signature or certificate chain — that requires a conformant C2PA library or tool (for example
[`c2patool`](https://opensource.contentauthenticity.org/docs/c2patool/)), which this dependency-light
project does not bundle. `result.verification.status` is always `"not-performed"`, with an
explanation, rather than a guess: presence of a marker is not proof of a valid manifest, and its
absence is not proof a file has no provenance history.

There is no removal or stripping function anywhere in this module (`tests/c2pa.test.ts` asserts
this directly) — inspection never modifies the file, by design.

### Honest result language

Recommended:

> Deterministic text artifacts cleaned. The text was substantially rewritten. Statistical watermark detectability is not verifiable without a public provider detector.

Do not say:

> Claude watermark successfully removed.

## Privacy and security

- `inspect`, `clean`, `report`, `provenance`, and fact-preservation checks run entirely locally — in the CLI, the library, and the browser UI.
- `prompt` only generates a request locally; it does not call an API.
- The rewrite provider adapter (`createOpenAiCompatibleAdapter` / the UI's rewrite panel) is the **only** feature that sends text over the network, is off by default, never requires credentials, and always discloses the destination endpoint before sending.
- No telemetry, analytics, accounts, or storage are included anywhere in this project, including the browser UI.
- Source text inside the generated prompt (and inside rewrite requests) is explicitly treated as untrusted data to reduce prompt-injection risk.
- The rewrite adapter never logs source text, enforces an input size limit, and supports timeouts and cancellation.
- Image provenance inspection never modifies the inspected file and never claims to cryptographically verify a manifest.
- Never paste confidential text into a third-party rewrite model unless its data handling is acceptable for that content.

See [SECURITY.md](SECURITY.md) for reporting and deployment guidance.

## Development

```bash
npm install --include=dev
npm test              # unit + integration tests (text, rewrite, CLI, report/schema, provider, C2PA, static server)
npm run build          # compile TypeScript to dist/
npm run check           # test + build
npm start                # build, then serve the browser UI at http://localhost:4300/
npm run serve             # serve an existing dist/ build without rebuilding
npm run test:e2e           # build, then run the Playwright browser E2E suite against the production build
npm run verify               # check + test:e2e — everything, end to end
npm run fixtures:images       # regenerate the binary C2PA/EXIF/XMP test fixtures under tests/fixtures/images/
```

`npm run test:e2e` downloads/uses a local Chromium via Playwright; run `npx playwright install --with-deps chromium` once first if it is not already installed.

The unit/integration suite covers Unicode inspection/cleaning, multilingual preservation,
rewrite-prompt boundaries, fact extraction/comparison, CLI behavior, JSON report generation against
the checked-in schema, the rewrite provider adapter (with `fetch` mocked — no live or paid API
calls are ever made in tests), C2PA/XMP/EXIF provenance inspection against representative binary
fixtures, and the static file server. The Playwright suite drives the actual served production
build in a real browser: pasting/uploading text, safe vs. aggressive cleaning, the diff view,
clipboard copy, file downloads, image provenance upload, and the rewrite panel's disclosure/consent
gating (with the network call intercepted by Playwright, never live).

## Status

Originally tracked as a roadmap, all of the following are implemented and covered by tests:

- a local browser UI with fully local inspection, safe/aggressive modes, a before/after diff, copy, and downloadable text/JSON
- a versioned, schema-validated JSON report format
- an optional, credential-free-by-default rewrite provider adapter architecture with an OpenAI-compatible adapter, explicit disclosure, timeouts/cancellation, input limits, and post-rewrite fact-preservation verification
- inspect-only C2PA/XMP/EXIF provenance inspection for PNG/JPEG/SVG, with honest (not-performed) signature verification status

## Responsible use

Use this project only with content you own or are authorized to process. Do not use it to misrepresent authorship, evade academic or workplace policies, or remove provenance signals where disclosure is legally or contractually required.

Not affiliated with or endorsed by Anthropic. Claude is a trademark of Anthropic PBC.

## License

MIT © 2026 Simon Funk
