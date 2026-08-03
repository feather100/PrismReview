/**
 * degradation.ts — T5 (Sprint 11.0) 按动作降级策略（来源：PR Council 模式 C）
 *
 * 语义：降级发生在「动作」粒度，而不是整场评审：
 *  - Reviewer 意见生成：真实 provider 失败 → 该 turn 降级 mock（providerSource='fallback_mock'，有标签，不进"真实"统计）；
 *    认证/守卫错误 → fail_closed（无降级，写失败存根，不阻塞整场）。
 *  - Moderator 决策：LLM 不可用 → 确定性决策链（MockModerator：信号/硬闸 → converge/continue/force_stop）。
 *
 * 本文件是纯策略层（可单测）；queue / llm-moderator 复用。
 */
export type TurnDegradationKind =
  | 'auth_fail_closed' // 401/403：失败即闭（不降级，防凭据泄漏）
  | 'guard_fail_closed' // 配置守卫错误：失败即闭
  | 'fallback_mock' // 真实 provider 运行时错误 → 单 turn 降级 mock（有标签）
  | 'mock_fail_closed'; // mock 自身失败（不应发生）：失败即闭

/** 错误 → 降级策略（纯函数）。 */
export function classifyTurnError(err: unknown, adapterName: string): TurnDegradationKind {
  const msg: string = (err as Error)?.message || String(err ?? '');
  if (msg.includes('HTTP 401') || msg.includes('HTTP 403')) return 'auth_fail_closed';
  if (msg.includes('GUARD') || msg.includes('MODEL PROVIDER GUARD')) return 'guard_fail_closed';
  if (adapterName !== 'mock') return 'fallback_mock';
  return 'mock_fail_closed';
}

/** 降级后可观测对象（providerSource 五态：mock/lmstudio/openai_compatible/fallback_mock/failed）。 */
export function buildTurnObservability(input: {
  providerSource: string;
  providerName: string;
  modelName: string;
  fallback: boolean;
  durationMs: number;
  tokens?: { prompt?: number; completion?: number; total?: number } | null;
  fallbackReason?: string;
  errorReason?: string;
}): Record<string, unknown> {
  return {
    providerSource: input.providerSource,
    providerName: input.providerName,
    modelName: input.modelName,
    fallback: input.fallback,
    durationMs: input.durationMs,
    tokens: input.tokens ?? null,
    fallbackReason: input.fallbackReason,
    errorReason: input.errorReason,
  };
}

/** 降级动作矩阵（供文档/测试断言）。 */
export const DEGRADATION_MATRIX: Record<TurnDegradationKind, { fallback: boolean; providerSource: string; retry: boolean }> = {
  auth_fail_closed: { fallback: false, providerSource: 'failed', retry: false },
  guard_fail_closed: { fallback: false, providerSource: 'failed', retry: false },
  fallback_mock: { fallback: true, providerSource: 'fallback_mock', retry: false },
  mock_fail_closed: { fallback: false, providerSource: 'failed', retry: false },
};
