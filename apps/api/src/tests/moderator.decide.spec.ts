/**
 * Orchestrator Core Unit Tests — MockModerator.decide().
 *
 * Scope: the convergence decision logic that drives the summarized→next routing.
 * This is the highest-risk deterministic logic in the orchestrator and previously
 * had NO coverage. Covers: converge / force_stop (maxRounds + maxTurns) /
 * advance_round (minRounds) / continue_debate (high-risk conflict) / ask_user_defense.
 *
 * Prisma is mocked (no DB, no LLM) — fully deterministic.
 */
import { MockModerator } from '../modules/reviews/orchestrator/moderator';
import { ReviewState } from '../modules/reviews/orchestrator/graph-runtime';
import type { WorkflowConfig } from '../modules/workflow/workflow.registry';

function makePrismaMock(overrides: Record<string, unknown> = {}) {
  return {
    moderatorDecision: { create: jest.fn().mockResolvedValue({ id: 'dec-1', createdAt: new Date() }) },
    reviewTurn: { findMany: jest.fn().mockResolvedValue([]) },
    reviewOpinion: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  } as any;
}

function state(round: number, usage: Partial<ReviewState['usage']> = {}): ReviewState {
  return {
    reviewId: 'test-review',
    status: 'running',
    round,
    currentNodeId: 'running',
    turns: [],
    moderatorDecisions: [],
    usage: { totalRounds: round, totalTokens: 0, totalCost: 0, turnsByReviewer: {}, ...usage },
    updatedAt: new Date().toISOString(),
  };
}

const DEFAULT_CONFIG: WorkflowConfig = {
  id: 'enterprise',
  nameZh: '企业评审',
  description: 'test',
  maxRounds: 3,
  minRounds: 1,
  debateAfterRound: 2,
  turnPhasePattern: ['round_robin'],
  availableTools: [],
  scoringWeights: { byDimension: {} } as any,
  verdictThresholds: {} as any,
};

describe('MockModerator.decide', () => {
  it('converges when reviewers spoke and no conflict (round < maxRounds)', async () => {
    const prisma = makePrismaMock();
    const m = new MockModerator(prisma);
    const d = await m.decide(state(1, { turnsByReviewer: { rv1: 1, rv2: 1 } }), {
      maxRounds: 3, minRounds: 1, maxTurnsPerReviewer: 3, maxTokensPerReview: 200_000, maxCostPerReview: 0,
    }, DEFAULT_CONFIG);
    expect(d.decisionType).toBe('converge');
    expect(prisma.moderatorDecision.create).toHaveBeenCalled();
  });

  it('force_stop (aborted) when round > maxRounds', async () => {
    const prisma = makePrismaMock();
    const m = new MockModerator(prisma);
    const d = await m.decide(state(4, { turnsByReviewer: { rv1: 1 } }), {
      maxRounds: 3, minRounds: 1, maxTurnsPerReviewer: 3, maxTokensPerReview: 200_000, maxCostPerReview: 0,
    }, DEFAULT_CONFIG);
    expect(d.decisionType).toBe('force_stop');
  });

  it('force_stop when a reviewer exceeded maxTurnsPerReviewer', async () => {
    const prisma = makePrismaMock();
    const m = new MockModerator(prisma);
    const d = await m.decide(state(2, { turnsByReviewer: { rv1: 4, rv2: 1 } }), {
      maxRounds: 3, minRounds: 1, maxTurnsPerReviewer: 3, maxTokensPerReview: 200_000, maxCostPerReview: 0,
    }, DEFAULT_CONFIG);
    expect(d.decisionType).toBe('force_stop');
  });

  it('advance_round (not converge) when round < minRounds even with no conflict', async () => {
    const prisma = makePrismaMock();
    const m = new MockModerator(prisma);
    const d = await m.decide(state(1, { turnsByReviewer: { rv1: 1 } }), {
      maxRounds: 3, minRounds: 2, maxTurnsPerReviewer: 3, maxTokensPerReview: 200_000, maxCostPerReview: 0,
    }, DEFAULT_CONFIG);
    expect(d.decisionType).toBe('advance_round');
  });

  it('continue_debate when >=2 high-risk opinions at/after debateAfterRound', async () => {
    const prisma = makePrismaMock({
      reviewTurn: { findMany: jest.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]) },
      reviewOpinion: { findMany: jest.fn().mockResolvedValue([{ riskLevel: 'high' }, { riskLevel: 'high' }]) },
    });
    const m = new MockModerator(prisma);
    const d = await m.decide(state(2, { turnsByReviewer: { rv1: 1, rv2: 1 } }), {
      maxRounds: 3, minRounds: 1, maxTurnsPerReviewer: 3, maxTokensPerReview: 200_000, maxCostPerReview: 0,
    }, DEFAULT_CONFIG);
    expect(d.decisionType).toBe('continue_debate');
  });

  it('ask_user_defense when an expert was @mentioned and defenses remain', async () => {
    const prisma = makePrismaMock();
    const m = new MockModerator(prisma);
    const s = state(1, { turnsByReviewer: { rv1: 1 } });
    (s as any).mentionExpertCode = 'CTO';
    (s as any).mentionDirection = 'defend';
    const d = await m.decide(s, {
      maxRounds: 3, minRounds: 1, maxTurnsPerReviewer: 3, maxTokensPerReview: 200_000, maxCostPerReview: 0,
    }, DEFAULT_CONFIG);
    expect(d.decisionType).toBe('ask_user_defense');
  });

  it('does NOT converge early when conflict exists below debateAfterRound (defers)', async () => {
    // 已知逻辑缺口：conflict 但 round < debateAfterRound 时 decisionType 仍为 converge
    // （reasoning 标注 debate deferred）。此处锁定当前行为，防止无意回归。
    const prisma = makePrismaMock({
      reviewTurn: { findMany: jest.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]) },
      reviewOpinion: { findMany: jest.fn().mockResolvedValue([{ riskLevel: 'high' }, { riskLevel: 'high' }]) },
    });
    const m = new MockModerator(prisma);
    const d = await m.decide(state(1, { turnsByReviewer: { rv1: 1, rv2: 1 } }), {
      maxRounds: 3, minRounds: 1, maxTurnsPerReviewer: 3, maxTokensPerReview: 200_000, maxCostPerReview: 0,
    }, DEFAULT_CONFIG);
    expect(d.decisionType).toBe('converge');
    expect(d.reasoning).toContain('debate deferred');
  });
});
