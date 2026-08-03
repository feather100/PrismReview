/**
 * calibration.ts — T10 (Sprint 11.0) 评分校准对照（来源：AssessmentAI 模式 P）
 *
 * AI 分 vs 人工分对照：|Δ| 分布 + 文本相似度（关键词 Jaccard）+ 越阈值标记（|Δ|>15 或相似度<0.40 → 待人工复核）。
 * 纯函数，可单测；无 embedding 依赖（用 CJK 二元组 Jaccard 作为轻量语义近似）。
 */
import { extractKeywords } from '../util/passages';

export interface HumanScore {
  readonly dimension: string;
  readonly score: number; // 0-100
  readonly comment?: string; // 人工关键意见（用于相似度对照）
}

export interface AiDimensionScore {
  readonly dimension: string;
  readonly aiScore: number; // 0-100（有效分）
  readonly aiIssue?: string; // AI 对该维度的关键意见文本
}

export interface CalibrationRow {
  readonly dimension: string;
  readonly aiScore: number;
  readonly humanScore: number;
  readonly delta: number; // |AI - 人工|
  readonly similarity: number | null; // 文本相似度（无双方文本时为 null）
  readonly flagged: boolean;
  readonly flagReason: string[];
}

export interface CalibrationOptions {
  readonly deltaThreshold?: number; // 默认 15
  readonly similarityThreshold?: number; // 默认 0.40
}

export interface CalibrationReport {
  readonly rows: CalibrationRow[];
  readonly mae: number; // 平均绝对误差
  readonly flaggedCount: number;
  readonly total: number;
}

/** 文本相似度：CJK 二元组 + 拉丁词 Jaccard（0-1）。空文本 → 0。 */
export function computeSimilarity(textA: string, textB: string): number {
  const a = extractKeywords(textA);
  const b = extractKeywords(textB);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * 对照计算：逐维度 AI vs 人工，标记 |Δ|>deltaThreshold 或（有双方文本且相似度<simThreshold）的行。
 */
export function computeCalibration(
  humanScores: readonly HumanScore[],
  aiScores: readonly AiDimensionScore[],
  options: CalibrationOptions = {},
): CalibrationReport {
  const deltaThreshold = options.deltaThreshold ?? 15;
  const similarityThreshold = options.similarityThreshold ?? 0.4;
  const aiByDim = new Map(aiScores.map((a) => [a.dimension, a]));
  const rows: CalibrationRow[] = [];

  for (const h of humanScores) {
    const ai = aiByDim.get(h.dimension);
    const aiScore = ai?.aiScore ?? 0;
    const delta = Math.abs(aiScore - h.score);
    const similarity =
      h.comment && ai?.aiIssue ? computeSimilarity(ai.aiIssue, h.comment) : null;
    const reason: string[] = [];
    if (delta > deltaThreshold) reason.push(`|Δ|=${delta.toFixed(1)} > ${deltaThreshold}`);
    if (similarity !== null && similarity < similarityThreshold)
      reason.push(`similarity=${similarity.toFixed(2)} < ${similarityThreshold}`);
    rows.push({
      dimension: h.dimension,
      aiScore: Number(aiScore.toFixed(2)),
      humanScore: h.score,
      delta: Number(delta.toFixed(2)),
      similarity: similarity === null ? null : Number(similarity.toFixed(4)),
      flagged: reason.length > 0,
      flagReason: reason,
    });
  }

  const mae =
    rows.length === 0 ? 0 : rows.reduce((a, r) => a + r.delta, 0) / rows.length;
  return {
    rows,
    mae: Number(mae.toFixed(2)),
    flaggedCount: rows.filter((r) => r.flagged).length,
    total: rows.length,
  };
}
