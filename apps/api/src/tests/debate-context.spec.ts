/**
 * T12 (Sprint 11.0) — Debate context: exclude own history + rolling window.
 *
 * Scope:
 *  - buildDebateContext（排除自己 / 滚动窗口 / 排序 / 空输入）
 */
import { buildDebateContext, PriorOpinion } from '../modules/reviews/util/debate-context';

function op(partial: Partial<PriorOpinion>): PriorOpinion {
  return {
    reviewerId: 'rv1', round: 1, dimension: '架构', issue: '单点故障', recommendation: '多副本', riskLevel: 'high',
    ...partial,
  };
}

describe('buildDebateContext (T12)', () => {
  it('excludes own prior opinions (防回声)', () => {
    const ctx = buildDebateContext(
      [
        op({ reviewerId: 'rv-me', round: 1, issue: '我自己的意见' }),
        op({ reviewerId: 'rv-other', round: 1, issue: '他人的意见' }),
      ],
      'rv-me',
    );
    expect(ctx).toContain('他人的意见');
    expect(ctx).not.toContain('我自己的意见');
  });

  it('keeps only the last windowRounds rounds (滚动窗口)', () => {
    const ctx = buildDebateContext(
      [
        op({ reviewerId: 'rv-a', round: 1, issue: 'round1' }),
        op({ reviewerId: 'rv-b', round: 2, issue: 'round2' }),
        op({ reviewerId: 'rv-c', round: 3, issue: 'round3' }),
      ],
      'rv-none',
      2,
    );
    expect(ctx).toContain('round2');
    expect(ctx).toContain('round3');
    expect(ctx).not.toContain('round1'); // 窗口外
  });

  it('formats as [r{round} {reviewer}] dimension(risk): issue → recommendation', () => {
    const ctx = buildDebateContext([op({ reviewerId: 'rv-a', round: 2, dimension: '安全', riskLevel: 'high', issue: '密钥泄漏', recommendation: '加密存储' })], 'rv-me');
    expect(ctx).toContain('[r2 rv-a] 安全(high): 密钥泄漏 → 加密存储');
  });

  it('returns empty when no other opinions', () => {
    expect(buildDebateContext([op({ reviewerId: 'rv-me' })], 'rv-me')).toBe('');
    expect(buildDebateContext([], 'rv-me')).toBe('');
  });
});
