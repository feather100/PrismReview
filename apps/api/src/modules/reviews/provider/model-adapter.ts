/**
 * model-adapter.ts — Unified Model Adapter abstraction (Sprint 2.1)
 *
 * Replaces the hardcoded env-driven provider call in queue.service.ts with a
 * pluggable ModelAdapter interface. Two built-in adapters:
 *   - MockAdapter        (name='mock', deterministic, zero-dependency, 0ms)
 *   - OpenAICompatibleAdapter (name='openai_compatible', /chat/completions,
 *                              Bearer key, GUARD fail-closed when key missing)
 *
 * The mock generation logic is migrated verbatim from the previous
 * queue.service.ts → scripts/provider-adapter.js MOCK_RESPONSES.
 */

// ── Adapter contract ──

export interface ModelInput {
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ModelOutput {
  text: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  model?: string;
}

export interface ModelAdapter {
  readonly name: string;
  complete(input: ModelInput): Promise<ModelOutput>;
}

// ── Migrated mock data (from scripts/provider-adapter.js MOCK_RESPONSES) ──

const MOCK_RESPONSES: Record<
  string,
  { dimension: string; riskLevel: string; issue: string; recommendation: string; confidenceScore: number }
> = {
  CTO: {
    dimension: '架构合理性',
    riskLevel: 'high',
    issue: '核心链路未设置熔断降级机制，存在单点故障风险',
    recommendation: '采用微服务架构拆分关键模块，设置超时和熔断机制',
    confidenceScore: 78,
  },
  CFO: {
    dimension: '投入产出分析',
    riskLevel: 'medium',
    issue: '初期投入较高，长期ROI可期但需分阶段验证',
    recommendation: '制定分阶段投入计划，首阶段聚焦核心功能验证',
    confidenceScore: 72,
  },
  PMO: {
    dimension: '交付风险',
    riskLevel: 'medium',
    issue: '排期紧张，关键路径存在外部依赖风险',
    recommendation: '增加20%排期缓冲，明确外部依赖时间表',
    confidenceScore: 65,
  },
  Compliance: {
    dimension: '数据安全与合规',
    riskLevel: 'high',
    issue: '方案涉及用户数据出境，需完成隐私影响评估',
    recommendation: '完成数据分类分级，确保数据加密传输和存储',
    confidenceScore: 80,
  },
  UserAdvocate: {
    dimension: '用户体验',
    riskLevel: 'low',
    issue: '学习成本偏高，缺乏新手引导',
    recommendation: '补充新手引导流程，优化关键页面加载性能',
    confidenceScore: 70,
  },
};

// ── Shared prompt + parsing helpers (used by both adapters + queue.service) ──

export const SYSTEM_PROMPT =
  'You are a technical reviewer. Review the provided proposal and output a single JSON object ' +
  'with these exact fields: riskLevel (high|medium|low|info), dimension, issue, recommendation, ' +
  'confidenceScore (0-100). Output ONLY valid JSON, no markdown, no explanation.';

export function stripMarkdown(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return m ? m[1].trim() : text.trim();
}

export function normalizeParsed(obj: any): any {
  if (Array.isArray(obj)) obj = obj[0];
  if (!obj || typeof obj !== 'object') return null;
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    // Normalize key to camelCase: uppercase-first → lowercase, ALLCAPS → lowercase
    const key = k[0].toLowerCase() + k.slice(1);
    // Detect confidenceScore case-insensitively
    if (key.toLowerCase().replace('_', '') === 'confidencescore') {
      out['confidenceScore'] = typeof v === 'string' ? parseFloat(v) || 50 : v;
    } else {
      out[key] = v;
    }
  }
  return out;
}

/** Extract roleCode from a prompt of the form "You are reviewing as {CODE}.\n\nProposal:..." */
export function extractRoleCode(prompt: string): string {
  const m = prompt.match(/as\s+([A-Za-z0-9_]+)\s*\./);
  return m ? m[1] : 'CTO';
}

/**
 * Parse a model output (raw JSON text) into a structured opinion object.
 * Returns null when the text is not valid opinion JSON.
 */
export function parseModelOpinion(text: string): any | null {
  try {
    return normalizeParsed(JSON.parse(stripMarkdown(text)));
  } catch {
    return null;
  }
}

// ── MockAdapter ──

export class MockAdapter implements ModelAdapter {
  readonly name = 'mock';

  constructor(private readonly responses: Record<string, any> = MOCK_RESPONSES) {}

  async complete(input: ModelInput): Promise<ModelOutput> {
    const roleCode = extractRoleCode(input.prompt);
    const base = this.responses[roleCode] || this.responses.CTO;
    return {
      text: JSON.stringify(base),
      model: 'mock',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }
}

// ── OpenAICompatibleAdapter ──

export interface OpenAICompatibleConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  maxTokens: number;
}

export class OpenAICompatibleAdapter implements ModelAdapter {
  readonly name = 'openai_compatible';

  constructor(private readonly config: OpenAICompatibleConfig) {}

  async complete(input: ModelInput): Promise<ModelOutput> {
    const { baseUrl, model, apiKey, timeoutMs, maxTokens } = this.config;

    // GUARD: missing key → fail closed (never default-enable external calls)
    if (!apiKey) {
      throw new Error(
        'MODEL PROVIDER GUARD: openai_compatible requires MODEL_API_KEY to be set.',
      );
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    headers['Authorization'] = 'Bearer ' + apiKey; // NOT logged

    const Controller: any = (globalThis as any).AbortController;
    const controller = new Controller();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: any;
    try {
      const fetchImpl: any = (globalThis as any).fetch;
      response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: input.system || SYSTEM_PROMPT },
            { role: 'user', content: input.prompt },
          ],
          temperature: input.temperature ?? 0.1,
          max_tokens: input.maxTokens ?? maxTokens,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API HTTP ${response.status}: ${text.substring(0, 500)}`);
    }

    const body: any = await response.json();
    const rawContent = stripMarkdown(body?.choices?.[0]?.message?.content || '');
    const usage = body?.usage;
    return {
      text: rawContent,
      model,
      usage: {
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens,
      },
    };
  }
}
