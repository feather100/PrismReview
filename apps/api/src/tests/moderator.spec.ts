/**
 * Orchestrator Core Unit Tests — Hard-Gate / Moderator rules.
 *
 * Scope: computeRuleCheck (code-forced, LLM cannot bypass), hard-gate limits.
 * No Prisma/LLM — all deterministic.
 */
import {
  computeRuleCheck,
  DEFAULT_HARD_GATES,
  HardGates,
  RuleCheckResult,
} from '../modules/reviews/orchestrator/moderator';
import { ReviewState } from '../modules/reviews/orchestrator/graph-runtime';

function state(round: number, usage: Partial<ReviewState['usage']>): ReviewState {
  return {
    reviewId: 'test',
    status: 'running',
    round,
    currentNodeId: 'running',
    turns: [],
    moderatorDecisions: [],
    usage: { totalRounds: round, totalTokens: 0, totalCost: 0, turnsByReviewer: {}, ...usage },
    updatedAt: new Date().toISOString(),
  };
}

describe('computeRuleCheck — default gates (maxRounds=3, maxTurns=3)', () => {
  const gates: HardGates = DEFAULT_HARD_GATES;

  it('passes when round=1, each reviewer spoke once, no tokens', () => {
    const r = computeRuleCheck(
      state(1, { totalTokens: 0, totalCost: 0, turnsByReviewer: { rv1: 1, rv2: 1 } }),
      gates,
    );
    expect(r.passed).toBe(true);
    expect(r.maxRoundsOk).toBe(true);
    expect(r.maxTurnsPerReviewerOk).toBe(true);
    expect(r.convergenceOk).toBe(true);
  });

  it('FAILS when any reviewer exceeded maxTurnsPerReviewer (3)', () => {
    const r = computeRuleCheck(
      state(2, { totalTokens: 0, totalCost: 0, turnsByReviewer: { rv1: 4 } }),
      gates,
    );
    expect(r.passed).toBe(false);
    expect(r.maxTurnsPerReviewerOk).toBe(false);
  });

  it('FAILS when round > maxRounds (3)', () => {
    const r = computeRuleCheck(
      state(4, { totalTokens: 0, totalCost: 0, turnsByReviewer: { rv1: 1 } }),
      gates,
    );
    expect(r.passed).toBe(false);
    expect(r.maxRoundsOk).toBe(false);
  });

  it('FAILS when no reviewers have spoken (convergence fail)', () => {
    const r = computeRuleCheck(
      state(1, { totalTokens: 0, totalCost: 0, turnsByReviewer: {} }),
      gates,
    );
    expect(r.passed).toBe(false);
    expect(r.convergenceOk).toBe(false);
  });

  it('FAILS when totalTokens > maxTokensPerReview', () => {
    const gates2: HardGates = { ...gates, maxTokensPerReview: 100 };
    const r = computeRuleCheck(
      state(1, { totalTokens: 200, totalCost: 0, turnsByReviewer: { rv1: 1 } }),
      gates2,
    );
    expect(r.passed).toBe(false);
    expect(r.maxTokensOk).toBe(false);
  });

  it('boundary: round == maxRounds (3) still passes', () => {
    const r = computeRuleCheck(
      state(3, { totalTokens: 0, totalCost: 0, turnsByReviewer: { rv1: 3, rv2: 3 } }),
      gates,
    );
    expect(r.maxRoundsOk).toBe(true);
    expect(r.maxTurnsPerReviewerOk).toBe(true);
  });

  it('boundary: reviewer at exactly maxTurns (3) still passes', () => {
    const r = computeRuleCheck(
      state(2, { totalTokens: 0, totalCost: 0, turnsByReviewer: { rv1: 3 } }),
      gates,
    );
    expect(r.maxTurnsPerReviewerOk).toBe(true);
  });
});

describe('all RuleCheckResult flags', () => {
  it('every flag is a boolean', () => {
    const r: RuleCheckResult = computeRuleCheck(
      state(1, { totalTokens: 0, totalCost: 0, turnsByReviewer: { rv1: 1 } }),
      DEFAULT_HARD_GATES,
    );
    const flags: (keyof RuleCheckResult)[] = [
      'maxRoundsOk',
      'maxTurnsPerReviewerOk',
      'maxTokensOk',
      'maxCostOk',
      'convergenceOk',
      'passed',
    ];
    for (const f of flags) {
      expect(typeof r[f]).toBe('boolean');
    }
  });
});
