/**
 * opinion.ts — 结构化 opinion schema（Contract §4）
 *
 * §4.1 基于现有 ReviewOpinion 结构泛化；§4.2 运行校验。
 * 校验失败 → turn failed + 写 failed opinion 存根（不阻塞整场）。
 */
export type RiskLevel = 'high' | 'medium' | 'low' | 'info';

export interface StructuredOpinion {
  readonly schemaVersion: string; // 新增，如 "1.0"
  readonly reviewerId: string; // roleVersionId
  readonly round: number;
  readonly dimension: string; // 非空
  readonly riskLevel: RiskLevel; // 枚举
  readonly issue: string; // 非空
  readonly recommendation: string; // 非空
  readonly citations: readonly string[];
  readonly confidenceScore: number; // [0,100] 整数
  readonly reasoningSummary?: string;
  readonly modelOutputRef?: string; // 既有 5 态 providerSource 落库
}

export interface OpinionValidationResult {
  readonly valid: boolean;
  readonly errors: string[];
}

const SCHEMA_VERSION_RE = /^\d+\.\d+$/;
const RISK_LEVELS: ReadonlySet<string> = new Set(['high', 'medium', 'low', 'info']);

export function validateOpinion(
  o: Partial<StructuredOpinion> | null | undefined,
): OpinionValidationResult {
  const errors: string[] = [];
  if (!o) {
    return { valid: false, errors: ['opinion is null/undefined'] };
  }

  if (typeof o.schemaVersion !== 'string' || !SCHEMA_VERSION_RE.test(o.schemaVersion)) {
    errors.push('schemaVersion missing or invalid (expected ^\\d+\\.\\d+$)');
  }
  if (typeof o.dimension !== 'string' || o.dimension.trim().length < 1) {
    errors.push('dimension required (non-empty)');
  }
  if (typeof o.riskLevel !== 'string' || !RISK_LEVELS.has(o.riskLevel)) {
    errors.push('riskLevel invalid (expected high|medium|low|info)');
  }
  if (typeof o.issue !== 'string' || o.issue.trim().length < 1) {
    errors.push('issue required (non-empty)');
  }
  if (typeof o.recommendation !== 'string' || o.recommendation.trim().length < 1) {
    errors.push('recommendation required (non-empty)');
  }
  if (!Array.isArray(o.citations) || !o.citations.every((c) => typeof c === 'string')) {
    errors.push('citations must be string[]');
  }
  if (
    typeof o.confidenceScore !== 'number' ||
    !Number.isFinite(o.confidenceScore) ||
    o.confidenceScore < 0 ||
    o.confidenceScore > 100 ||
    !Number.isInteger(o.confidenceScore)
  ) {
    errors.push('confidenceScore must be integer [0,100]');
  }
  if (o.modelOutputRef !== undefined && o.modelOutputRef !== null) {
    if (typeof o.modelOutputRef !== 'string') {
      errors.push('modelOutputRef must be string');
    } else {
      try {
        const parsed = JSON.parse(o.modelOutputRef);
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          typeof (parsed as { providerSource?: unknown }).providerSource !== 'string'
        ) {
          errors.push('modelOutputRef must JSON-parse to object with providerSource');
        }
      } catch {
        errors.push('modelOutputRef must be JSON-parseable');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
