# Security Policy

## Reporting a vulnerability

Please report security issues privately to the repository owner through GitHub's private vulnerability reporting feature. Do not include confidential source text, credentials, or production data in a report.

## Security model

The core package is intentionally local and dependency-light:

- deterministic inspection, cleaning, JSON report generation, and C2PA/XMP/EXIF provenance inspection do not use a network, in the CLI, the library, or the bundled browser UI (`web/`);
- prompt construction does not submit text to a model;
- the optional rewrite provider adapter (`createOpenAiCompatibleAdapter`) is the only network-capable feature, is off by default in the UI, never requires an API key, enforces a request timeout and input size limit, supports caller cancellation, never logs source text, and discloses its destination endpoint before sending;
- source text is delimited and labelled as untrusted data;
- the project contains no telemetry or persistence layer.

The bundled static server (`scripts/serve.mjs`, run via `npm run serve` / `npm start`) is meant for
local, single-user use on `localhost`. It has no authentication, rate limiting, or request logging.
Do not expose it directly to the internet or a shared network without adding those controls
yourself (see "Guidance for hosted integrations" below).

## Guidance for hosted integrations

A hosted UI or rewrite API built around this package should add, at minimum:

- explicit retention and model-provider disclosures;
- server-side input and output size limits;
- rate limiting and abuse controls;
- authentication where appropriate;
- log redaction and no source-text logging by default;
- timeouts and cancellation for model calls;
- output validation using `comparePreservedFacts`;
- content-security policy and standard web hardening;
- deletion procedures and a documented incident process.

Never represent a statistical watermark as detected or removed unless the relevant model provider publishes a detector and the exact input/output has been tested against it.
