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
  jsonMode?: boolean; // 启用 response_format={type:json_object}
  lang?: 'zh' | 'en'; // 语言提示（由 queue.service 根据内容检测后传入）
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

/**
 * SYSTEM_PROMPT — language-aware.
 *
 * Détecte la langue du contenu (ratio CJK) et génère un prompt adapté :
 *   - Contenu majoritairement chinois  → prompt + réponse en CHINOIS
 *   - Contenu majoritairement latin    → prompt + réponse en ANGLAIS
 *
 * Les clés JSON restent toujours en anglais (riskLevel, dimension, …) pour
 * que le parseur fonctionne ; seul le *texte de réponse* (issue, recommendation,
 * dimension) et les instructions changent de langue.
 */
export function buildSystemPrompt(content: string): string {
  const isChinese = isLikelyChinese(content);
  if (isChinese) {
    return (
      '你是一名资深架构评审专家。阅读以下方案，并用**中文**回答一个严格的 JSON 对象\n' +
      '(不要 markdown、不要推理过程、前后不要任何说明文字)。必须**只**包含以下键：\n' +
      'riskLevel (high|medium|low|info 之一), dimension (字符串，**用中文**), issue (字符串，**用中文**), ' +
      'recommendation (字符串，**用中文**), confidenceScore (0-100 整数)。\n' +
      '重要：只输出原始 JSON 节点 —— 不要 ```json 围栏，不要翻译键为英文，' +
      '所有中文描述使用简体中文。'
    );
  }
  return (
    'You are an expert architecture reviewer. Read the proposal below and respond with ' +
    'ONE strict JSON object (no markdown, no commentary, no prose before or after) with EXACTLY these keys: ' +
    'riskLevel (one of: high|medium|low|info), dimension (string), issue (string), ' +
    'recommendation (string), confidenceScore (integer 0-100). ' +
    'IMPORTANT: output the raw JSON object only — do not wrap in ```json fences, ' +
    'do not add any explanation, do not translate keys into Chinese.'
  );
}

/** Heuristique : texte majoritairement latin (anglais). */
function isLikelyEnglish(text: string): boolean {
  if (!text) return false;
  const total = text.length;
  let latin = 0;
  for (let i = 0; i < total; i++) {
    const code = text.charCodeAt(i);
    if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin++;
  }
  return total > 0 && latin / total > 0.4;
}

/** Heuristique CJK : >15% de caractères CJK → considéré comme chinois. */
export function isLikelyChinese(text: string): boolean {
  if (!text) return false;
  const total = text.length;
  let cjk = 0;
  for (let i = 0; i < total; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0x20000 && code <= 0x2a6df) // CJK Extension B
    ) {
      cjk++;
    }
  }
  return total > 0 && cjk / total > 0.15;
}

/** @deprecated Use buildSystemPrompt(content) instead. Kept for any direct callers. */
export const SYSTEM_PROMPT = buildSystemPrompt('');

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
 * 从文本中提取最"完整"的 JSON 对象（支持 reasoning_content 长推理文本）。
 * 策略：找出所有 {..} 候选，按长度降序排序，尝试 JSON.parse，首个成功即返回。
 * 这样 reasoning 文本里靠后出现（更大）的优先，应对 LongCat-2.0 / DeepSeek-R1。
 */
function extractBestJsonObject(text: string): any | null {
  // 找所有顶层 {..} 匹配（非贪婪但包含嵌套——基于启发式找 "}\s*[,\n\]}]" 或文本末尾）
  const candidates: string[] = [];
  const re = /\{[\s\S]*?\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) candidates.push(m[0]);
  // 按长度降序（更完整的 JSON 通常更长）
  candidates.sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    try {
      const parsed = normalizeParsed(JSON.parse(c));
      if (parsed && (parsed.riskLevel || parsed.dimension || parsed.confidenceScore !== undefined)) return parsed;
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Parse a model output (raw JSON text) into a structured opinion object.
 * Tolerant: accepts pure JSON, ```json fenced blocks, JSON embedded in prose,
 * and LongCat-2.0 / DeepSeek-R1 thinking-style output (reasoning_content that
 * embeds the final JSON near the end).
 * Returns null when no valid opinion JSON can be found.
 */
export function parseModelOpinion(text: string): any | null {
  if (!text) return null;
  const cleaned = stripMarkdown(text);
  // 1) 整体就是 JSON
  try {
    const r = normalizeParsed(JSON.parse(cleaned));
    if (r) return r;
  } catch { /* continue */ }
  // 2) 文本中嵌入 JSON（含 reasoning_content）
  return extractBestJsonObject(cleaned);
}

// ── English mock seeds (same keys, English text) ──────────────────────────

const MOCK_RESPONSES_EN: Record<string, { dimension: string; riskLevel: string; issue: string; recommendation: string; confidenceScore: number }> = {
  CTO: { dimension: 'Architecture & Performance', riskLevel: 'high', issue: 'Core link has no circuit-breaker / degradation mechanism, single-point-of-failure risk.', recommendation: 'Split into independently deployable microservices with per-service timeouts, circuit breakers, and HA deployment.', confidenceScore: 78 },
  CFO: { dimension: 'Cost-Benefit & ROI', riskLevel: 'medium', issue: 'High upfront investment; long-term ROI is promising but requires phased validation.', recommendation: 'Adopt a phased funding plan, validate core value in phase 1 before full rollout, and define clear ROI gates.', confidenceScore: 72 },
  PMO: { dimension: 'Delivery Risk', riskLevel: 'medium', issue: 'Schedule is tight with external dependency risk on the critical path.', recommendation: 'Add 20% schedule buffer, lock external dependency owners and dates, set milestone checkpoints.', confidenceScore: 65 },
  Compliance: { dimension: 'Security & Compliance', riskLevel: 'high', issue: 'Proposal involves cross-border user data transfer; privacy impact assessment (PIA) is required.', recommendation: 'Complete data classification and grading, ensure encrypted transit/storage, establish data-access audit trail.', confidenceScore: 80 },
  UserAdvocate: { dimension: 'User Experience', riskLevel: 'low', issue: 'Learning curve is high for existing users; onboarding docs are missing.', recommendation: 'Add a guided onboarding flow, in-app tooltips, and optimise key page load to under 2s.', confidenceScore: 70 },
};

// ── MockAdapter ──────────────────────────────────────────────────────────

export class MockAdapter implements ModelAdapter {
  readonly name = 'mock';

  async complete(input: ModelInput): Promise<ModelOutput> {
    const roleCode = extractRoleCode(input.prompt);
    // 语言由 queue.service 传入；默认中文（项目主语言）
    const isZh = input.lang !== 'en';
    const table = isZh ? MOCK_RESPONSES : MOCK_RESPONSES_EN;
    // (debug removed)
    const base = table[roleCode] || table.CTO;
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
          // 强制输出合法 JSON payload。
          // - LongCat-2.0 仅支持 text / json_schema（不支持 json_object），用 text + 强 prompt。
          // - 纯 OpenAI / vLLM 等支持 json_object。通过 provider 配置选择；默认 text。
          ...(input.jsonMode && false ? { response_format: { type: 'json_object' } } : {}),
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
    const choice = body?.choices?.[0];
    // LongCat-2.0 / 思考型模型（DeepSeek-R1 风格）把最终答案放进 reasoning_content；
    // 优先读 message.content，为空则回填 reasoning_content（含最终结论）。
    const rawPrimary = choice?.message?.content || '';
    const rawReasoning = choice?.message?.reasoning_content || choice?.message?.reasoning || '';
    const rawContent = rawPrimary ? stripMarkdown(rawPrimary) : (rawReasoning || '');
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
