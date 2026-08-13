# Security Policy

## Reporting a vulnerability

Please report security issues privately to the repository owner through GitHub's private vulnerability reporting feature. Do not include confidential source text, credentials, or production data in a report.

## Security model

The core package is intentionally local and dependency-light:

- deterministic inspection and cleaning do not use a network;
- prompt construction does not submit text to a model;
- source text is delimited and labelled as untrusted data;
- the project contains no telemetry or persistence layer.

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
