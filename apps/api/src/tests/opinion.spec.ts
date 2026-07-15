/**
 * Orchestrator Core Unit Tests — opinion validation.
 *
 * Scope: validateOpinion (StructuredOpinion schema enforcement).
 * No Prisma/LLM — all deterministic.
 */
import { validateOpinion, RiskLevel, StructuredOpinion } from '../modules/reviews/orchestrator/opinion';

function validOpinion(): Partial<StructuredOpinion> {
  return {
    schemaVersion: '1.0',
    reviewerId: 'rv-1',
    round: 1,
    dimension: '架构合理性',
    riskLevel: 'high',
    issue: '存在单点故障风险',
    recommendation: '部署多副本+熔断机制',
    citations: ['doc-1', 'doc-2'],
    confidenceScore: 85,
    modelOutputRef: JSON.stringify({ providerSource: 'mock', model: 'mock' }),
  };
}

describe('validateOpinion', () => {
  it('accepts a fully-built structured opinion', () => {
    const r = validateOpinion(validOpinion());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects null/undefined', () => {
    expect(validateOpinion(null).valid).toBe(false);
    expect(validateOpinion(undefined).valid).toBe(false);
  });

  it('rejects missing schemaVersion or bad format', () => {
    expect(validateOpinion({ ...validOpinion(), schemaVersion: undefined }).valid).toBe(false);
    expect(validateOpinion({ ...validOpinion(), schemaVersion: '1' }).valid).toBe(false);
    expect(validateOpinion({ ...validOpinion(), schemaVersion: 'v1.0' }).valid).toBe(false);
  });

  it.each([['high'], ['medium'], ['low'], ['info']])('accepts valid riskLevel %s', (level) => {
    expect(validateOpinion({ ...validOpinion(), riskLevel: level as RiskLevel }).valid).toBe(true);
  });

  it('rejects invalid riskLevel', () => {
    expect(validateOpinion({ ...validOpinion(), riskLevel: 'critical' as any }).valid).toBe(false);
  });

  it('rejects empty issue/dimension/recommendation', () => {
    expect(validateOpinion({ ...validOpinion(), issue: '' }).valid).toBe(false);
    expect(validateOpinion({ ...validOpinion(), recommendation: '  ' }).valid).toBe(false);
    expect(validateOpinion({ ...validOpinion(), dimension: '' }).valid).toBe(false);
  });

  it('rejects non-string citation entries', () => {
    expect(validateOpinion({ ...validOpinion(), citations: ['a', 2 as any] }).valid).toBe(false);
  });

  it.each([
    [-1, 'negative'],
    [101, 'over 100'],
    [50.5, 'non-integer'],
    [NaN, 'NaN'],
  ])('rejects confidenceScore=%s (%s)', (score, _desc) => {
    expect(validateOpinion({ ...validOpinion(), confidenceScore: score }).valid).toBe(false);
  });

  it.each([0, 50, 100])('accepts boundary confidenceScore=%s', (score) => {
    expect(validateOpinion({ ...validOpinion(), confidenceScore: score }).valid).toBe(true);
  });

  it('requires modelOutputRef to JSON-parse to object with providerSource', () => {
    expect(validateOpinion({ ...validOpinion(), modelOutputRef: 'not-json' }).valid).toBe(false);
    expect(validateOpinion({ ...validOpinion(), modelOutputRef: JSON.stringify({ foo: 1 }) }).valid).toBe(false);
  });

  it('allows modelOutputRef to be omitted', () => {
    const { modelOutputRef, ...rest } = validOpinion();
    expect(validateOpinion(rest).valid).toBe(true);
  });

  it('collects multiple errors at once', () => {
    const r = validateOpinion({
      schemaVersion: 'bad',
      riskLevel: 'invalid' as any,
      issue: '',
      recommendation: 'x', // 正确的 key，但 confidenceScore 200 会触发错误
      confidenceScore: 200,
    });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});
