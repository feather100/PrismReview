/**
 * PrismReview — Provider Adapter (Sprint 4.4B)
 *
 * Unified interface for Agent Turn providers:
 * - mock (default, zero dependencies)
 * - lmstudio (local LM Studio, guarded)
 * - openai_compatible (external API, guarded + budget)
 */

// ── Schema ──
/** @typedef {{ roleCode: string, dimension: string, riskLevel: string, issue: string, recommendation: string, confidenceScore: number, rawText?: string, provider?: string, model?: string, durationMs?: number }} AgentTurnResult */

// ── Mock Provider ──

const MOCK_RESPONSES = {
  CTO: { dimension: '架构合理性', riskLevel: 'high', issue: '核心链路未设置熔断降级机制，存在单点故障风险', recommendation: '采用微服务架构拆分关键模块，设置超时和熔断机制', confidenceScore: 78 },
  CFO: { dimension: '投入产出分析', riskLevel: 'medium', issue: '初期投入较高，长期ROI可期但需分阶段验证', recommendation: '制定分阶段投入计划，首阶段聚焦核心功能验证', confidenceScore: 72 },
  PMO: { dimension: '交付风险', riskLevel: 'medium', issue: '排期紧张，关键路径存在外部依赖风险', recommendation: '增加20%排期缓冲，明确外部依赖时间表', confidenceScore: 65 },
  Compliance: { dimension: '数据安全与合规', riskLevel: 'high', issue: '方案涉及用户数据出境，需完成隐私影响评估', recommendation: '完成数据分类分级，确保数据加密传输和存储', confidenceScore: 80 },
  UserAdvocate: { dimension: '用户体验', riskLevel: 'low', issue: '学习成本偏高，缺乏新手引导', recommendation: '补充新手引导流程，优化关键页面加载性能', confidenceScore: 70 },
};

function mockProvider(roleCode) {
  const base = MOCK_RESPONSES[roleCode] || MOCK_RESPONSES.CTO;
  return { roleCode, ...base, rawText: JSON.stringify(base), provider: 'mock', model: 'mock', durationMs: 0 };
}

// ── Configuration ──

function getConfig() {
  // Backward compat: LMSTUDIO_BASE_URL → MODEL_BASE_URL
  const baseUrl = process.env.MODEL_BASE_URL || process.env.LMSTUDIO_BASE_URL || 'http://127.0.0.1:1234/v1';
  const model = process.env.MODEL_NAME || process.env.LMSTUDIO_MODEL || 'google/gemma-4-12b';
  const timeoutMs = parseInt(process.env.MODEL_TIMEOUT_MS || '120000', 10);
  const maxTokens = parseInt(process.env.MODEL_MAX_TOKENS || '2048', 10);
  const apiKey = process.env.MODEL_API_KEY || '';
  const budgetLimit = parseFloat(process.env.MODEL_BUDGET_LIMIT || '0.10');
  const dailyCallLimit = parseInt(process.env.MODEL_DAILY_CALL_LIMIT || '100', 10);
  return { baseUrl, model, timeoutMs, maxTokens, apiKey, budgetLimit, dailyCallLimit };
}

// ── Budget & Circuit Breaker ──

let dailyCalls = 0;
let dailyReset = Date.now();
let totalCost = 0;
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function resetDaily() {
  if (Date.now() - dailyReset > 86400000) { dailyCalls = 0; dailyReset = Date.now(); }
}

function checkBudget() {
  resetDaily();
  const cfg = getConfig();
  if (dailyCalls >= cfg.dailyCallLimit) throw new Error('DAILY CALL LIMIT EXCEEDED: ' + cfg.dailyCallLimit + ' calls/day');
  if (totalCost > cfg.budgetLimit) throw new Error('BUDGET LIMIT EXCEEDED: $' + totalCost.toFixed(4) + ' > $' + cfg.budgetLimit);
}

function checkCircuit() {
  if (circuitOpenUntil > Date.now()) throw new Error('CIRCUIT BREAKER OPEN: retry after ' + new Date(circuitOpenUntil).toISOString());
}

function recordSuccess() { dailyCalls++; consecutiveFailures = 0; }
function recordFailure() {
  dailyCalls++; consecutiveFailures++;
  if (consecutiveFailures >= 5) {
    circuitOpenUntil = Date.now() + 900000; // 15 minutes
    console.warn('[CircuitBreaker] OPEN — 15 min cooldown after 5 consecutive failures');
  }
}

function estimateCost(usage) {
  const promptTokens = usage?.prompt_tokens || 0;
  const completionTokens = usage?.completion_tokens || 0;
  return (promptTokens * 0.000001 + completionTokens * 0.000003); // approximate
}

// ── Shared helpers ──

const SYSTEM_PROMPT = `You are a technical reviewer. Review the provided proposal and output a single JSON object with these exact fields: riskLevel (high|medium|low|info), dimension, issue, recommendation, confidenceScore (0-100). Output ONLY valid JSON, no markdown, no explanation.`;

function stripMarkdown(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return m ? m[1].trim() : text.trim();
}

function normalizeParsed(obj) {
  if (Array.isArray(obj)) obj = obj[0];
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
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

async function callOpenAICompatible(baseUrl, model, apiKey, timeoutMs, maxTokens, roleCode, proposal) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;  // NOT logged

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST', headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `You are reviewing as ${roleCode}.\n\nProposal:\n${proposal}` },
        ],
        temperature: 0.1, max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });
  } finally { clearTimeout(timer); }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API HTTP ${response.status}: ${text.substring(0, 500)}`);
  }

  const body = await response.json();
  let rawContent = body?.choices?.[0]?.message?.content || '';
  rawContent = stripMarkdown(rawContent);
  let parsed = null;
  try { parsed = normalizeParsed(JSON.parse(rawContent)); } catch { /* ignore */ }

  if (!parsed || !parsed.riskLevel) {
    throw new Error(`Unparseable response: ${rawContent.substring(0, 300)}`);
  }

  const cost = estimateCost(body.usage);
  totalCost += cost;

  return {
    roleCode,
    dimension: parsed.dimension || '',
    riskLevel: (parsed.riskLevel || '').toLowerCase(),
    issue: parsed.issue || '',
    recommendation: parsed.recommendation || '',
    confidenceScore: typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 50,
    rawText: rawContent,
    provider: 'openai_compatible',
    model,
    durationMs: 0,
  };
}

// ── LM Studio Provider ──

async function lmstudioProvider(roleCode, proposal) {
  const cfg = getConfig();

  const start = Date.now();
  const result = await callOpenAICompatible(cfg.baseUrl, cfg.model, '', cfg.timeoutMs, cfg.maxTokens, roleCode, proposal);
  result.durationMs = Date.now() - start;
  result.provider = 'lmstudio';

  recordSuccess();
  return result;
}

// ── OpenAI Compatible Provider ──

async function openaiCompatibleProvider(roleCode, proposal) {
  const cfg = getConfig();
  if (!cfg.apiKey) throw new Error('MODEL_API_KEY is required for openai_compatible provider');
  checkBudget(); checkCircuit();

  const start = Date.now();
  const result = await callOpenAICompatible(cfg.baseUrl, cfg.model, cfg.apiKey, cfg.timeoutMs, cfg.maxTokens, roleCode, proposal);
  result.durationMs = Date.now() - start;
  result.provider = 'openai_compatible';

  recordSuccess();
  return result;
}

// ── Factory ──

/**
 * Get the appropriate provider based on environment.
 *
 * Behavior:
 *   MODEL_PROVIDER unset or "mock" → mock (no error)
 *   MODEL_PROVIDER=lmstudio + ALLOW_EXTERNAL_MODEL_CALLS=true → lmstudio
 *   MODEL_PROVIDER=lmstudio + allow not true → throw GUARD
 *   MODEL_PROVIDER=openai_compatible + allow + MODEL_API_KEY → openai_compatible
 *   MODEL_PROVIDER=openai_compatible + missing allow/key → throw GUARD
 *   Unknown MODEL_PROVIDER → throw Unsupported provider
 */
function getProvider() {
  const provider = (process.env.MODEL_PROVIDER || '').toLowerCase();
  const allow = process.env.ALLOW_EXTERNAL_MODEL_CALLS || '';

  if (!provider || provider === 'mock') {
    return { name: 'mock', run: mockProvider };
  }

  if (provider === 'lmstudio') {
    if (allow !== 'true') {
      throw new Error(
        'MODEL PROVIDER GUARD: MODEL_PROVIDER=lmstudio requires ALLOW_EXTERNAL_MODEL_CALLS=true.\n' +
        'Set both env vars to enable LM Studio calls.');
    }
    return { name: 'lmstudio', run: lmstudioProvider };
  }

  if (provider === 'openai_compatible') {
    if (allow !== 'true') {
      throw new Error(
        'MODEL PROVIDER GUARD: MODEL_PROVIDER=openai_compatible requires ALLOW_EXTERNAL_MODEL_CALLS=true.');
    }
    const cfg = getConfig();
    if (!cfg.apiKey) {
      throw new Error(
        'MODEL PROVIDER GUARD: openai_compatible requires MODEL_API_KEY to be set.');
    }
    return { name: 'openai_compatible', run: openaiCompatibleProvider };
  }

  throw new Error(`Unsupported MODEL_PROVIDER: "${provider}". Supported: "mock", "lmstudio", "openai_compatible".`);
}

module.exports = { mockProvider, lmstudioProvider, openaiCompatibleProvider, getProvider, checkBudget, checkCircuit, stripMarkdown, normalizeParsed };
