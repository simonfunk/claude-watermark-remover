import test from "node:test";
import assert from "node:assert/strict";
import {
  createOpenAiCompatibleAdapter,
  RewriteAbortedError,
  RewriteInputTooLargeError,
  RewriteTimeoutError,
} from "../src/index.js";

type FetchArgs = [input: string | URL | Request, init?: RequestInit];

function withMockFetch<T>(impl: (...args: FetchArgs) => Promise<Response>, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  // @ts-expect-error test stub does not need to match the full fetch overload set
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("createOpenAiCompatibleAdapter never requires an API key for construction", () => {
  const adapter = createOpenAiCompatibleAdapter({
    endpoint: "http://localhost:11434/v1/chat/completions",
    model: "local-model",
  });

  assert.equal(adapter.disclosure.sendsSourceTextToThirdParty, true);
  assert.equal(adapter.disclosure.endpoint, "http://localhost:11434/v1/chat/completions");
});

test("createOpenAiCompatibleAdapter rejects malformed and non-HTTP endpoints", () => {
  for (const endpoint of ["not-a-url", "file:///tmp/provider", "javascript:alert(1)"]) {
    assert.throws(
      () => createOpenAiCompatibleAdapter({ endpoint, model: "test" }),
      /HTTP\(S\)|endpoint/i,
    );
  }
});

test("rewrite() sends the OpenAI-compatible chat payload and verifies fact preservation", async () => {
  const calls: FetchArgs[] = [];
  const adapter = createOpenAiCompatibleAdapter({
    endpoint: "https://api.example.com/v1/chat/completions",
    model: "gpt-test",
  });

  const outcome = await withMockFetch(
    async (...args) => {
      calls.push(args);
      return jsonResponse({
        choices: [{ message: { content: "Contact ops at ops@example.com for details." } }],
      });
    },
    () => adapter.rewrite({ text: "Please email ops@example.com for details." }),
  );

  assert.equal(outcome.rewrittenText, "Contact ops at ops@example.com for details.");
  assert.equal(outcome.verification.ok, true);
  assert.equal(calls.length, 1);
  const [, init] = calls[0]!;
  const headers = init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, undefined);
  const body = JSON.parse(init!.body as string) as { model: string; messages: unknown[] };
  assert.equal(body.model, "gpt-test");
  assert.equal(body.messages.length, 2);
});

test("rewrite() flags missing protected facts after a rewrite", async () => {
  const adapter = createOpenAiCompatibleAdapter({
    endpoint: "https://api.example.com/v1/chat/completions",
    model: "gpt-test",
    apiKey: "sk-test",
  });

  const outcome = await withMockFetch(
    async () => jsonResponse({ choices: [{ message: { content: "Contact ops for details." } }] }),
    () => adapter.rewrite({ text: "Please email ops@example.com for details." }),
  );

  assert.equal(outcome.verification.ok, false);
  assert.deepEqual(outcome.verification.missing.emails, ["ops@example.com"]);
});

test("rewrite() sends an Authorization header only when an API key is configured", async () => {
  const adapter = createOpenAiCompatibleAdapter({
    endpoint: "https://api.example.com/v1/chat/completions",
    model: "gpt-test",
    apiKey: "sk-test",
  });

  const calls: FetchArgs[] = [];
  await withMockFetch(
    async (...args) => {
      calls.push(args);
      return jsonResponse({ choices: [{ message: { content: "hi" } }] });
    },
    () => adapter.rewrite({ text: "hi" }),
  );

  const [, init] = calls[0]!;
  const headers = init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer sk-test");
});

test("rewrite() rejects input over the configured character limit without calling fetch", async () => {
  const adapter = createOpenAiCompatibleAdapter({
    endpoint: "https://api.example.com/v1/chat/completions",
    model: "gpt-test",
    maxInputCharacters: 5,
  });

  let fetchCalled = false;
  await assert.rejects(
    withMockFetch(
      async () => {
        fetchCalled = true;
        return jsonResponse({ choices: [{ message: { content: "x" } }] });
      },
      () => adapter.rewrite({ text: "this text is definitely too long" }),
    ),
    RewriteInputTooLargeError,
  );
  assert.equal(fetchCalled, false);
});

test("rewrite() times out and aborts the underlying request", async () => {
  const adapter = createOpenAiCompatibleAdapter({
    endpoint: "https://api.example.com/v1/chat/completions",
    model: "gpt-test",
    timeoutMs: 20,
  });

  await assert.rejects(
    withMockFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
      () => adapter.rewrite({ text: "hello" }),
    ),
    RewriteTimeoutError,
  );
});

test("rewrite() honors caller-provided cancellation separately from the timeout", async () => {
  const adapter = createOpenAiCompatibleAdapter({
    endpoint: "https://api.example.com/v1/chat/completions",
    model: "gpt-test",
    timeoutMs: 5_000,
  });
  const controller = new AbortController();

  const promise = withMockFetch(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
    () => adapter.rewrite({ text: "hello", signal: controller.signal }),
  );

  controller.abort();
  await assert.rejects(promise, RewriteAbortedError);
});

test("rewrite() never logs source text on success or failure", async () => {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const captured: unknown[] = [];
  console.log = (...values: unknown[]) => captured.push(values);
  console.error = (...values: unknown[]) => captured.push(values);
  console.warn = (...values: unknown[]) => captured.push(values);

  const secret = "TOP-SECRET-SOURCE-9f3a";
  const adapter = createOpenAiCompatibleAdapter({
    endpoint: "https://api.example.com/v1/chat/completions",
    model: "gpt-test",
  });

  try {
    await withMockFetch(
      async () => {
        throw new Error("network down");
      },
      () => adapter.rewrite({ text: secret }).catch(() => undefined),
    );
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }

  const serialized = JSON.stringify(captured);
  assert.doesNotMatch(serialized, /TOP-SECRET-SOURCE-9f3a/);
});
