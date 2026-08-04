/**
 * ReviewOrchestrator.resume() — HITL 恢复路径回归测试（2026-08-04 research demo）。
 *
 * 背景：中断时当前轮 turn 已全部终态，resume 后 checkMeetingComplete 入队的
 * meeting.complete 会被 processedIds 幂等拦截 → handleTurnsComplete 永不触发 →
 * 评审卡在 running。修复：resume 先判定当前轮是否已全部终态；是则直接推进收敛。
 */
import { ReviewOrchestrator } from '../modules/reviews/orchestrator/review-orchestrator';
import { Moderator } from '../modules/reviews/orchestrator/moderator';

function makePrismaMock(initial: any) {
  const review = { ...initial };
  return {
    review: {
      findUnique: jest.fn(async () => ({ ...review })),
      update: jest.fn(async ({ data }: any) => { Object.assign(review, data); return review; }),
    },
    reviewTurn: { count: jest.fn(async () => 0) },
    reviewOpinion: { findMany: jest.fn(async () => []) },
    moderatorDecision: { create: jest.fn(async () => ({ id: 'dec', createdAt: new Date() })) },
    agentRole: { findMany: jest.fn(async () => []) },
    _review: review,
  } as any;
}

function makeQueue() {
  return {
    enqueue: jest.fn(),
    checkMeetingComplete: jest.fn(async () => {}),
    getProcessedIds: jest.fn(() => []),
    deleteProcessedId: jest.fn(),
  } as any;
}

function makeModerator(): Moderator {
  return {
    decide: jest.fn(async () => ({
      id: 'dec-1',
      reviewId: 'review-1',
      round: 3,
      decisionType: 'converge' as const,
      reasoning: 'human gate approved → converge to completed',
      ruleCheckResult: {} as any,
      createdAt: new Date().toISOString(),
    })),
  };
}

function baseReview() {
  return {
    id: 'review-1',
    status: 'interrupted',
    mode: 'research',
    currentRound: 3,
    currentNodeId: 'interrupted',
    humanGateApproved: false,
    escalationCount: 1,
    defenseCount: 0,
    roleSelection: { roles: [{ roleId: 'r1' }, { roleId: 'r2' }] },
    turns: [],
    moderatorDecisions: [],
  };
}

describe('ReviewOrchestrator.resume (HITL 恢复)', () => {
  let queue: any;
  let moderator: Moderator;
  let checkpointer: any;

  beforeEach(() => {
    jest.clearAllMocks();
    queue = makeQueue();
    moderator = makeModerator();
    checkpointer = { save: jest.fn(async () => {}) };
  });

  it('直接完成：当前轮已全部终态 → 跳过重派发，走 handleTurnsComplete → completed', async () => {
    const prisma = makePrismaMock(baseReview());
    (prisma.reviewTurn.count as jest.Mock).mockResolvedValue(2); // expectedCount = 2
    const orch = new ReviewOrchestrator(queue, prisma, checkpointer, moderator);
    await orch.resume('review-1');
    expect(prisma._review.status).toBe('completed');
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(queue.checkMeetingComplete).not.toHaveBeenCalled();
    expect(moderator.decide).toHaveBeenCalledTimes(1);
    const nodes = (checkpointer.save as jest.Mock).mock.calls.map((c: any[]) => c[1]);
    expect(nodes).toContain('running');
    expect(nodes).toContain('summarized');
    expect(nodes).toContain('completed');
  });

  it('重派发：当前轮未全部终态（中途 interrupt）→ enqueue review.start，保持 running', async () => {
    const prisma = makePrismaMock(baseReview());
    (prisma.reviewTurn.count as jest.Mock).mockResolvedValue(1); // 1/2 terminal
    const orch = new ReviewOrchestrator(queue, prisma, checkpointer, moderator);
    await orch.resume('review-1');
    expect(prisma._review.status).toBe('running');
    expect(queue.enqueue).toHaveBeenCalledWith('review.start', expect.objectContaining({ reviewId: 'review-1', round: 3 }));
    expect(queue.checkMeetingComplete).toHaveBeenCalledWith('review-1');
    expect(moderator.decide).not.toHaveBeenCalled();
  });
});
