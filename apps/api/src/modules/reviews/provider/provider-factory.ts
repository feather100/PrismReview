/**
 * provider-factory.ts — ModelAdapter factory (Sprint 2.1)
 *
 * createProviderAdapter(env?) resolves the right ModelAdapter from environment.
 *
 * Multi-guard fallback: any unrecognized provider, or an external provider
 * without ALLOW_EXTERNAL_MODEL_CALLS=true, resolves to MockAdapter. External
 * (real) providers are NEVER default-enabled.
 *
 *   env unset / "mock"                        → MockAdapter
 *   "lmstudio"            + allow!=="true"    → MockAdapter (GUARD fallback)
 *   "openai_compatible"   + allow!=="true"    → MockAdapter (GUARD fallback)
 *   "lmstudio"            + allow==="true"    → OpenAICompatibleAdapter (LM Studio is OpenAI-compatible)
 *   "openai_compatible"   + allow==="true"    → OpenAICompatibleAdapter (GUARD at complete() if key missing)
 *   unknown provider                            → MockAdapter
 */

import {
  ModelAdapter,
  MockAdapter,
  OpenAICompatibleAdapter,
} from './model-adapter';

export interface ProviderEnv {
  MODEL_PROVIDER?: string;
  ALLOW_EXTERNAL_MODEL_CALLS?: string;
  MODEL_BASE_URL?: string;
  LMSTUDIO_BASE_URL?: string;
  MODEL_NAME?: string;
  LMSTUDIO_MODEL?: string;
  MODEL_API_KEY?: string;
  MODEL_TIMEOUT_MS?: string;
  MODEL_MAX_TOKENS?: string;
  [key: string]: string | undefined;
}

function resolveConfig(env: ProviderEnv) {
  const baseUrl =
    env.MODEL_BASE_URL || env.LMSTUDIO_BASE_URL || 'http://127.0.0.1:1234/v1';
  const model = env.MODEL_NAME || env.LMSTUDIO_MODEL || 'google/gemma-4-12b';
  const timeoutMs = parseInt(env.MODEL_TIMEOUT_MS || '120000', 10) || 120000;
  const maxTokens = parseInt(env.MODEL_MAX_TOKENS || '2048', 10) || 2048;
  return { baseUrl, model, timeoutMs, maxTokens };
}

export function createProviderAdapter(env: ProviderEnv = process.env): ModelAdapter {
  const provider = (env.MODEL_PROVIDER || '').toLowerCase();
  const allow = env.ALLOW_EXTERNAL_MODEL_CALLS || '';

  // Default / mock / unrecognized → mock (zero dependencies, deterministic)
  if (!provider || provider === 'mock') {
    return new MockAdapter();
  }

  // External providers require explicit opt-in
  if (provider === 'openai_compatible' || provider === 'lmstudio') {
    // Multi-guard fallback: not explicitly allowed → mock
    if (allow !== 'true') {
      return new MockAdapter();
    }
    const { baseUrl, model, timeoutMs, maxTokens } = resolveConfig(env);
    // When allowed, construct the real adapter. The adapter itself GUARDs at
    // complete() time if MODEL_API_KEY is missing (fail-closed, never falls
    // back to mock silently).
    return new OpenAICompatibleAdapter({
      baseUrl,
      model,
      apiKey: env.MODEL_API_KEY,
      timeoutMs,
      maxTokens,
    });
  }

  // Unrecognized provider → mock (fail-safe)
  return new MockAdapter();
}
