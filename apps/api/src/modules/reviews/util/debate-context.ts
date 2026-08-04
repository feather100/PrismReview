/**
 * debate-context.ts — T12 (Sprint 11.0) 辩论上下文（来源：Solutioning Room 模式 R）
 *
 * 语义：round≥2 辩论时给评审员注入"其他专家"的上轮意见（回应对象），
 * 但**排除自己的上轮意见**（防回声自我强化）；滚动窗口保留最近 N 轮。
 */
export interface PriorOpinion {
  readonly reviewerId: string; // roleVersionId
  readonly round: number;
  readonly dimension: string;
  readonly issue: string;
  readonly recommendation: string;
  readonly riskLevel: string;
}

/**
 * 构建辩论上下文：排除 excludeReviewerId 自己的意见，保留最近 windowRounds 轮，按轮次升序格式化。
 * 无他人意见 → 返回空串（调用方不注入）。
 */
export function buildDebateContext(
  opinions: readonly PriorOpinion[],
  excludeReviewerId: string,
  windowRounds = 2,
): string {
  const others = opinions.filter((o) => o.reviewerId !== excludeReviewerId);
  if (others.length === 0) return '';
  const maxRound = Math.max(...others.map((o) => o.round));
  const minRound = maxRound - windowRounds + 1;
  const inWindow = others
    .filter((o) => o.round >= minRound)
    .sort((a, b) => a.round - b.round || a.reviewerId.localeCompare(b.reviewerId));
  return inWindow
    .map(
      (o) =>
        `[r${o.round} ${o.reviewerId}] ${o.dimension}(${o.riskLevel}): ${o.issue} → ${o.recommendation}`,
    )
    .join('\n');
}
