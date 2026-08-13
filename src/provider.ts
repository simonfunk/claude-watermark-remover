import { buildRewritePrompt, comparePreservedFacts, type FactComparison } from "./rewrite.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_INPUT_CHARACTERS = 20_000;

export class RewriteProviderError extends Error {}
export class RewriteTimeoutError extends RewriteProviderError {
  constructor() {
    super("Rewrite request timed out.");
  }
}
export class RewriteAbortedError extends RewriteProviderError {
  constructor() {
    super("Rewrite request was cancelled.");
  }
}
export class RewriteInputTooLargeError extends RewriteProviderError {
  constructor(limit: number) {
    super(`Input exceeds the configured limit of ${limit} characters.`);
  }
}
export class RewriteResponseError extends RewriteProviderError {
  constructor(detail: string) {
    super(`Rewrite provider returned an unusable response: ${detail}`);
  }
}

export interface RewriteProviderConfig {
  /** Full URL of an OpenAI-compatible chat completions endpoint. Can point at a local server. */
  endpoint: string;
  model: string;
  /** Never required: local/self-hosted OpenAI-compatible servers typically need no key. */
  apiKey?: string;
  timeoutMs?: number;
  maxInputCharacters?: number;
}

export interface RewriteProviderDisclosure {
  providerName: string;
  endpoint: string;
  model: string;
  /** Always true: any configured rewrite provider receives the source text over the network. */
  sendsSourceTextToThirdParty: true;
  retentionNote: string;
}

export interface RewriteRequest {
  text: string;
  strength?: "light" | "strong";
  locale?: string;
  brandVoice?: string;
  /** Caller-controlled cancellation, independent of the built-in timeout. */
  signal?: AbortSignal;
}

export interface RewriteOutcome {
  rewrittenText: string;
  provider: { name: string; endpoint: string; model: string };
  verification: FactComparison;
}

export interface RewriteProvider {
  readonly disclosure: RewriteProviderDisclosure;
  rewrite(request: RewriteRequest): Promise<RewriteOutcome>;
}

const RETENTION_NOTE =
  "Source text is sent to the configured endpoint for this single request only. This project does not control that provider's retention policy — check the provider's own data handling terms before sending confidential text.";

function combineSignals(signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const active = signals.filter((signal): signal is AbortSignal => signal !== undefined);

  const onAbort = (signal: AbortSignal) => {
    controller.abort(signal.reason);
  };
  const listeners = active.map((signal) => {
    const listener = () => onAbort(signal);
    if (signal.aborted) {
      onAbort(signal);
    } else {
      signal.addEventListener("abort", listener, { once: true });
    }
    return { signal, listener };
  });

  return {
    signal: controller.signal,
    dispose: () => {
      for (const { signal, listener } of listeners) {
        signal.removeEventListener("abort", listener);
      }
    },
  };
}

export function createOpenAiCompatibleAdapter(config: RewriteProviderConfig): RewriteProvider {
  let endpoint: URL;
  try {
    endpoint = new URL(config.endpoint);
  } catch {
    throw new RewriteProviderError("Rewrite endpoint must be a valid HTTP(S) URL.");
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new RewriteProviderError("Rewrite endpoint must be a valid HTTP(S) URL.");
  }
  if (endpoint.username || endpoint.password) {
    throw new RewriteProviderError("Rewrite endpoint must not contain credentials.");
  }
  if (!config.model.trim()) {
    throw new RewriteProviderError("Rewrite model must not be empty.");
  }
  const endpointUrl = endpoint.toString();
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxInputCharacters = config.maxInputCharacters ?? DEFAULT_MAX_INPUT_CHARACTERS;
  if (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RewriteProviderError("Rewrite timeout must be a positive integer.");
  }
  if (!Number.isFinite(maxInputCharacters) || !Number.isInteger(maxInputCharacters) || maxInputCharacters <= 0) {
    throw new RewriteProviderError("Maximum input characters must be a positive integer.");
  }

  const disclosure: RewriteProviderDisclosure = {
    providerName: "openai-compatible",
    endpoint: endpointUrl,
    model: config.model,
    sendsSourceTextToThirdParty: true,
    retentionNote: RETENTION_NOTE,
  };

  return {
    disclosure,
    async rewrite(request: RewriteRequest): Promise<RewriteOutcome> {
      if ([...request.text].length > maxInputCharacters) {
        throw new RewriteInputTooLargeError(maxInputCharacters);
      }

      const prompt = buildRewritePrompt(request.text, {
        ...(request.strength ? { strength: request.strength } : {}),
        ...(request.locale ? { locale: request.locale } : {}),
        ...(request.brandVoice ? { brandVoice: request.brandVoice } : {}),
      });

      const timeoutController = new AbortController();
      const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
      const { signal, dispose } = combineSignals([timeoutController.signal, request.signal]);

      const headers: Record<string, string> = { "content-type": "application/json" };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

      let response: Response;
      try {
        response = await fetch(endpointUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user },
            ],
          }),
          signal,
        });
      } catch (error) {
        if (request.signal?.aborted) throw new RewriteAbortedError();
        if (timeoutController.signal.aborted) throw new RewriteTimeoutError();
        throw new RewriteProviderError("Rewrite request failed before receiving a response.");
      } finally {
        clearTimeout(timer);
        dispose();
      }

      if (!response.ok) {
        throw new RewriteResponseError(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const rewrittenText = payload.choices?.[0]?.message?.content;
      if (typeof rewrittenText !== "string") {
        throw new RewriteResponseError("missing choices[0].message.content");
      }

      return {
        rewrittenText,
        provider: { name: disclosure.providerName, endpoint: endpointUrl, model: config.model },
        verification: comparePreservedFacts(request.text, rewrittenText),
      };
    },
  };
}
