/**
 * lm-studio-adapter.ts — LM Studio real provider adapter (Sprint 2.2)
 *
 * LM Studio exposes an OpenAI-compatible `/v1/chat/completions` endpoint at
 * `http://127.0.0.1:1234/v1` by default. Unlike a hosted OpenAI-compatible
 * provider, a *local* LM Studio server typically does NOT require an API key
 * (it may optionally accept one). This adapter therefore:
 *   - does NOT fail-closed on a missing key (key is optional / compatible);
 *   - routes through the unified `ModelAdapter` interface;
 *   - returns `name='lmstudio'` so `providerSource`落库 is distinguishable
 *     from `openai_compatible` / `mock` / `fallback_mock` / `failed`.
 *
 * Error handling distinguishes retryable (timeout / connection / 5xx) from
 * non-retryable (401 / 403 auth, malformed response). Auth errors keep an
 * `HTTP 401` / `HTTP 403` marker in the message so `queue.service`'s existing
 * NO_RETRY (fail-closed, no fallback) detection still fires.
 *
 * Red-line guards (Sprint 2.2):
 *   - dev-only; only instantiated when ALLOW_EXTERNAL_MODEL_CALLS=true AND
 *     MODEL_PROVIDER=lmstudio (enforced in provider-factory.ts).
 *   - No secrets are read/written here beyond an optional MODEL_API_KEY, which
 *     is never logged.
 */

import {
  ModelAdapter,
  ModelInput,
  ModelOutput,
  SYSTEM_PROMPT,
  stripMarkdown,
} from './model-adapter';

export type LmStudioErrorKind =
  | 'timeout'
  | 'connection'
  | 'auth'
  | 'http'
  | 'unknown';

/**
 * Structured error carrying retryability + kind so callers (queue.service,
 * integration tests) can branch on `retryable` rather than string-matching.
 */
export class LmStudioAdapterError extends Error {
  readonly kind: LmStudioErrorKind;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    kind: LmStudioErrorKind,
    retryable: boolean,
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = 'LmStudioAdapterError';
    this.kind = kind;
    this.retryable = retryable;
    this.status = status;
    // Restore prototype chain (TS ES5 target + extends Error)
    Object.setPrototypeOf(this, LmStudioAdapterError.prototype);
  }
}

export interface LmStudioConfig {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxTokens?: number;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:1234/v1';
const DEFAULT_MODEL = 'google/gemma-4-12b';
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_TOKENS = 2048;

export class LmStudioAdapter implements ModelAdapter {
  readonly name = 'lmstudio';

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;

  constructor(config: LmStudioConfig = {}) {
    this.baseUrl =
      config.baseUrl ||
      process.env.LMSTUDIO_BASE_URL ||
      process.env.MODEL_BASE_URL ||
      DEFAULT_BASE_URL;
    this.model =
      config.model ||
      process.env.MODEL_NAME ||
      process.env.LMSTUDIO_MODEL ||
      DEFAULT_MODEL;
    // Optional — local LM Studio usually needs none; still compatible.
    this.apiKey = config.apiKey || process.env.MODEL_API_KEY;
    this.timeoutMs =
      config.timeoutMs || parseInt(process.env.MODEL_TIMEOUT_MS || '', 10) || DEFAULT_TIMEOUT_MS;
    this.maxTokens =
      config.maxTokens || parseInt(process.env.MODEL_MAX_TOKENS || '', 10) || DEFAULT_MAX_TOKENS;
  }

  async complete(input: ModelInput): Promise<ModelOutput> {
    const base = this.baseUrl.replace(/\/+$/, '');
    const url = `${base}/chat/completions`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      // Compatible with LM Studio servers that enforce a key. NEVER logged.
      headers['Authorization'] = 'Bearer ' + this.apiKey;
    }

    const Controller: any = (globalThis as any).AbortController;
    const controller = new Controller();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: any;
    try {
      const fetchImpl: any = (globalThis as any).fetch;
      response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: input.system || SYSTEM_PROMPT },
            { role: 'user', content: input.prompt },
          ],
          temperature: input.temperature ?? 0.1,
          max_tokens: input.maxTokens ?? this.maxTokens,
        }),
        signal: controller.signal,
      });
    } catch (err: any) {
      // AbortController abort → our timeout fired. Retryable.
      if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        throw new LmStudioAdapterError(
          'timeout',
          true,
          `LM Studio request timed out after ${this.timeoutMs}ms (${url})`,
        );
      }
      // Network / connection error (ECONNREFUSED, DNS, socket reset) → retryable.
      throw new LmStudioAdapterError(
        'connection',
        true,
        `Cannot connect to LM Studio at ${url}: ${err?.message || String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const status = response.status;
      // Auth errors: fail closed, non-retryable. Keep the `HTTP 401` / `HTTP 403`
      // marker so queue.service's NO_RETRY detection (no fallback) still triggers.
      if (status === 401 || status === 403) {
        throw new LmStudioAdapterError(
          'auth',
          false,
          `LM Studio HTTP ${status}: ${text.substring(0, 500)}`,
          status,
        );
      }
      // 429 / 5xx → retryable (caller may retry or fall back to mock).
      throw new LmStudioAdapterError(
        'http',
        true,
        `LM Studio HTTP ${status}: ${text.substring(0, 500)}`,
        status,
      );
    }

    let body: any;
    try {
      body = await response.json();
    } catch (err: any) {
      throw new LmStudioAdapterError(
        'unknown',
        false,
        `LM Studio returned a non-JSON response: ${err?.message || String(err)}`,
      );
    }

    const msg = body?.choices?.[0]?.message || {};
    // Reasoning models (e.g. Gemma 4 12b, this project's local provider) may
    // emit chain-of-thought into `reasoning_content` and leave `content` empty
    // when the token budget is exhausted. Prefer `content`; fall back to
    // `reasoning_content` for robustness (primary JSON path stays `content`).
    const rawContent = stripMarkdown(msg.content || msg.reasoning_content || '');
    if (!rawContent) {
      throw new LmStudioAdapterError(
        'unknown',
        false,
        `LM Studio returned empty content (model=${this.model})`,
      );
    }

    const usage = body?.usage;
    return {
      text: rawContent,
      model: this.model,
      usage: {
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens,
      },
    };
  }
}
