/**
 * cost-model.ts — T6 (Sprint 11.0) 评审成本模型（来源：Lavern 模式 H + v1.2 第十节）
 *
 * 语义：按 provider 单价 × token 估算单次调用成本（USD）。
 *  - mock / lmstudio（本地）= $0；
 *  - openai_compatible = 按 input/output 单价（默认 $1.5/M input + $4/M output，可 env 覆盖）。
 * 纯函数，可单测；env 覆盖在调用时读取（保持可测）。
 */
export interface TokenUsage {
  readonly prompt?: number;
  readonly completion?: number;
  readonly total?: number;
}

export interface TokenPrice {
  readonly inputPer1K: number; // USD / 1K input tokens
  readonly outputPer1K: number; // USD / 1K output tokens
}

/** 默认单价表（providerName → 单价）。本地/零成本 provider 恒 0。 */
export const DEFAULT_TOKEN_PRICES: Record<string, TokenPrice> = {
  mock: { inputPer1K: 0, outputPer1K: 0 },
  lmstudio: { inputPer1K: 0, outputPer1K: 0 },
  openai_compatible: { inputPer1K: 0.0015, outputPer1K: 0.004 },
  fallback_mock: { inputPer1K: 0, outputPer1K: 0 },
};

/** env 覆盖（openai_compatible 单价，单位 USD / 1K tokens）。 */
export function resolveTokenPrice(providerName: string): TokenPrice {
  const p = DEFAULT_TOKEN_PRICES[providerName] ?? DEFAULT_TOKEN_PRICES.openai_compatible;
  if (providerName === 'openai_compatible') {
    const in1k = parseFloat(process.env.MODEL_INPUT_PRICE_PER_1K ?? '');
    const out1k = parseFloat(process.env.MODEL_OUTPUT_PRICE_PER_1K ?? '');
    return {
      inputPer1K: Number.isFinite(in1k) && in1k >= 0 ? in1k : p.inputPer1K,
      outputPer1K: Number.isFinite(out1k) && out1k >= 0 ? out1k : p.outputPer1K,
    };
  }
  return p;
}

/** 估算单次调用成本（USD）。缺 prompt/completion 时退回 total × input 单价。 */
export function estimateCostUsd(providerName: string, usage: TokenUsage | null | undefined): number {
  if (!usage) return 0;
  const price = resolveTokenPrice(providerName);
  const prompt = Number(usage.prompt) || 0;
  const completion = Number(usage.completion) || 0;
  const total = Number(usage.total) || 0;
  if (prompt > 0 || completion > 0) {
    return (prompt * price.inputPer1K + completion * price.outputPer1K) / 1000;
  }
  // 只有 total：按 input 单价近似（保守下限）
  return (total * price.inputPer1K) / 1000;
}

/** 从可观测对象（modelOutputRef JSON）解析 token 明细。 */
export function extractTokens(observability: unknown): TokenUsage | null {
  if (!observability || typeof observability !== 'object') return null;
  const o = observability as Record<string, unknown>;
  const t = o.tokens;
  if (!t || typeof t !== 'object') return null;
  const tt = t as Record<string, unknown>;
  const prompt = typeof tt.prompt === 'number' ? tt.prompt : undefined;
  const completion = typeof tt.completion === 'number' ? tt.completion : undefined;
  const total = typeof tt.total === 'number' ? tt.total : undefined;
  if (prompt === undefined && completion === undefined && total === undefined) return null;
  return { prompt, completion, total };
}

/** 从可观测对象解析 providerName（成本单价键）。 */
export function extractProviderName(observability: unknown): string {
  if (!observability || typeof observability !== 'object') return 'mock';
  const o = observability as Record<string, unknown>;
  const p = typeof o.providerName === 'string' ? o.providerName : undefined;
  if (p) return p;
  return typeof o.providerSource === 'string' ? (o.providerSource as string) : 'mock';
}
