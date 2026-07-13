/**
 * review-orchestrator.ts — ReviewOrchestrator（P1 编排核心，Contract §9.1）
 *
 * 用 graph 脊柱驱动：
 *   created → diagnosed → running(r1, 并行 reviewer turns via 包装 QueueService)
 *            → summarized(Moderator converge) → completed
 *
 * 设计要点：
 *  - **包装**既有 QueueService（不替换）：turn 执行仍走 QueueService.enqueue('review.start')
 *    → executeAgentTurn（DB 幂等 + applyPilotRoleCap 泛化硬闸）。
 *  - 每个节点转移后 checkpointer.save（Postgres）。
 *  - mock Moderator 在 round-1 summarized 后只做 converge → completed（无 round-2 辩论，9.5 范围）。
 *  - 单轮不会触顶 max_rounds（=3），但硬闸检查代码存在（每转移前校验）。
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import {
  Graph,
  Node,
  NodeCtx,
  ReviewState,
  isTerminalStatus,
} from './graph-runtime';
import { PostgresCheckpointer } from './postgres-checkpointer';
import { MockModerator, HardGates, DEFAULT_HARD_GATES, toDecisionRef } from './moderator';
import { resolveHardGates } from './hard-gates';

@Injectable()
export class ReviewOrchestrator implements OnModuleInit {
  private readonly logger = new Logger(ReviewOrchestrator.name);
  private readonly graph: Graph<ReviewState>;

  constructor(
    private readonly queue: QueueService,
    private readonly prisma: PrismaService,
    private readonly checkpointer: PostgresCheckpointer,
    private readonly moderator: MockModerator,
  ) {
    this.graph = this.buildGraph();
  }

  /** 模块初始化：把 queue 的完成回调接到编排脊柱（single-round converge）。 */
  onModuleInit(): void {
    this.queue.completionHook = (reviewId: string) => this.handleTurnsComplete(reviewId);
    this.logger.log('ReviewOrchestrator wired to QueueService.completionHook');
  }

  private get ctx(): NodeCtx {
    return {
      logger: this.logger,
      tracer: undefined, // P1 仅 stub
      checkpointer: this.checkpointer,
      queue: this.queue,
      prisma: this.prisma,
      // modelAdapter / memoryService / promptService: P2/P3 注入位（P1 传 undefined）
    };
  }

  // ── Graph 定义（Contract §2.1）──
  private buildGraph(): Graph<ReviewState> {
    const nodes: Record<string, Node<ReviewState>> = {
      created: async () => ({ status: 'created', currentNodeId: 'created' }),
      diagnosed: async () => ({ status: 'diagnosed', currentNodeId: 'diagnosed' }),
      running: (state, ctx) => this.nodeRunning(state, ctx),
      summarized: async () => ({ status: 'summarized', currentNodeId: 'summarized' }),
      completed: async () => ({ status: 'completed', currentNodeId: 'completed' }),
      failed: async () => ({ status: 'failed', currentNodeId: 'failed' }),
      aborted: async () => ({ status: 'aborted', currentNodeId: 'aborted' }),
    };
    return {
      nodes,
      edges: [
        { kind: 'static', from: 'created', to: 'diagnosed' },
        { kind: 'static', from: 'diagnosed', to: 'running' },
        { kind: 'static', from: 'running', to: 'summarized' },
        {
          kind: 'conditional',
          from: 'summarized',
          route: (s) => (s.status === 'aborted' ? 'aborted' : 'completed'),
        },
        { kind: 'static', from: 'summarized', to: 'completed' },
        { kind: 'static', from: 'running', to: 'failed' },
      ],
      start: 'created',
    };
  }

  // ── Entry: created→running 派发 round-1（由 reviews.service.startReview 调用）──
  async start(reviewId: string): Promise<void> {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new Error(`Review not found: ${reviewId}`);
    if (review.status !== 'running') {
      this.logger.warn(
        `Orchestrator.start: review ${reviewId.substring(0, 8)} status=${review.status} != running, skip dispatch`,
      );
      return;
    }
    const state = await this.buildState(reviewId);
    const patch = await this.graph.nodes['running'](state, this.ctx);
    const next = { ...state, ...patch } as ReviewState;
    await this.checkpoint(reviewId, 'running', next);
    await this.persistState(reviewId, next);
    this.logger.log(`Spine: review ${reviewId.substring(0, 8)} dispatched round-1 (running)`);
  }

  /**
   * running(r1) 节点：硬闸校验 + 通过包装的 QueueService 派发并行 reviewer turns。
   * 实际 turn 执行（executeAgentTurn）在 QueueService 内完成，含 DB 幂等 + 每评审员硬闸。
   * turn 异步完成；全部终态后 QueueService 触发 completionHook → handleTurnsComplete。
   */
  private async nodeRunning(
    state: Readonly<ReviewState>,
    _ctx: NodeCtx,
  ): Promise<Partial<ReviewState>> {
    const gates = resolveHardGates();
    // 硬闸：max_rounds（代码强制）。单轮 round=1 远未触顶，但检查存在。
    if (state.round > gates.maxRounds) {
      this.logger.warn(
        `max_rounds breached (round=${state.round} > maxRounds=${gates.maxRounds}) → force_stop`,
      );
      return { status: 'aborted', currentNodeId: 'aborted' };
    }

    // 派发 round-1 并行 reviewer turns（包装 QueueService；review.start 内部按角色派发）
    this.queue.enqueue('review.start', {
      reviewId: state.reviewId,
      sessionId: `session-${state.reviewId}`,
    });

    return { status: 'running', currentNodeId: 'running', round: state.round };
  }

  /**
   * 全部 turn 终态后由 QueueService.completionHook 调用：
   * running → summarized(Moderator converge) → completed。
   * 写 ModeratorDecision 审计 + 每节点 checkpoint。
   */
  async handleTurnsComplete(reviewId: string): Promise<void> {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) return;
    if (review.status !== 'running') {
      this.logger.log(
        `handleTurnsComplete: review ${reviewId.substring(0, 8)} already ${review.status}, skip`,
      );
      return;
    }

    const state = await this.buildState(reviewId);
    const gates: HardGates = resolveHardGates();

    // summarized 节点：运行 MockModerator
    const decision = await this.moderator.decide(state, gates);
    const summarizedState: ReviewState = {
      ...state,
      status: 'summarized',
      currentNodeId: 'summarized',
      moderatorDecisions: [...state.moderatorDecisions, toDecisionRef(decision)],
      convergenceScore: decision.decisionType === 'converge' ? 1 : 0,
      updatedAt: new Date().toISOString(),
    };
    await this.checkpoint(reviewId, 'summarized', summarizedState);
    await this.persistState(reviewId, summarizedState);

    if (decision.decisionType === 'force_stop') {
      const abortedState: ReviewState = {
        ...summarizedState,
        status: 'aborted',
        currentNodeId: 'aborted',
        updatedAt: new Date().toISOString(),
      };
      await this.checkpoint(reviewId, 'aborted', abortedState);
      await this.persistState(reviewId, abortedState);
      this.logger.log(`Spine: review ${reviewId.substring(0, 8)} force_stop → aborted`);
      return;
    }

    // converge → completed
    const completedState: ReviewState = {
      ...summarizedState,
      status: 'completed',
      currentNodeId: 'completed',
      updatedAt: new Date().toISOString(),
    };
    await this.checkpoint(reviewId, 'completed', completedState);
    await this.persistState(reviewId, completedState);
    this.logger.log(`Spine complete: review ${reviewId.substring(0, 8)} → completed (single-round)`);
  }

  /**
   * 崩溃恢复：从最新 checkpoint 的 currentNodeId resume。
   *  - running：重派发 pending turns（幂等）+ 重查完成（幂等）
   *  - summarized：直接走 handleTurnsComplete（补完成）
   */
  async resume(reviewId: string): Promise<void> {
    const cp = await this.checkpointer.load(reviewId);
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) return;
    const nodeId = cp?.nodeId ?? review.currentNodeId ?? 'running';
    this.logger.log(`Resume: review ${reviewId.substring(0, 8)} from node ${nodeId}`);

    if (nodeId === 'running') {
      await this.start(reviewId); // 幂等：重派发 review.start；已终态 turn 跳过
      await this.handleTurnsComplete(reviewId); // 幂等：若已 completed 则 skip
    } else if (nodeId === 'summarized') {
      await this.handleTurnsComplete(reviewId);
    } else {
      this.logger.log(`Resume: nothing to do at node ${nodeId}`);
    }
  }

  // ── State 构建 / 持久化 ──

  private async buildState(reviewId: string): Promise<ReviewState> {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: { turns: true, moderatorDecisions: true },
    });
    if (!review) throw new Error(`Review not found: ${reviewId}`);

    const turnsRaw = (review.turns as unknown[]) ?? [];
    const turnsByReviewer: Record<string, number> = {};
    for (const t of turnsRaw) {
      const rid = (t as { roleVersionId?: string }).roleVersionId;
      if (rid) turnsByReviewer[rid] = (turnsByReviewer[rid] ?? 0) + 1;
    }

    const decisionsRaw = (review.moderatorDecisions as unknown[]) ?? [];
    const moderatorDecisions = decisionsRaw.map((d) => {
      const dd = d as { id: string; round: number; decisionType: string };
      return { decisionId: dd.id, round: dd.round, decisionType: dd.decisionType as never };
    });

    const reviewAny = review as unknown as {
      currentRound?: number;
      currentNodeId?: string | null;
    };

    return {
      reviewId,
      status: review.status as ReviewState['status'],
      round: reviewAny.currentRound ?? 1,
      currentNodeId: reviewAny.currentNodeId ?? 'running',
      turns: turnsRaw.map((t) => {
        const tt = t as {
          id: string;
          roleVersionId: string;
          round: number;
          phase?: string | null;
        };
        return {
          turnId: tt.id,
          reviewerId: tt.roleVersionId,
          round: tt.round,
          phase: tt.phase === 'debate' ? ('debate' as const) : ('round_robin' as const),
          status: 'persisted' as const,
          opinionRef: undefined,
        };
      }),
      moderatorDecisions,
      usage: {
        totalTokens: 0,
        totalRounds: reviewAny.currentRound ?? 1,
        turnsByReviewer,
        totalCost: 0,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  private async checkpoint(reviewId: string, nodeId: string, state: ReviewState): Promise<void> {
    await this.checkpointer.save(reviewId, nodeId, state);
  }

  private async persistState(reviewId: string, state: ReviewState): Promise<void> {
    await this.prisma.review.update({
      where: { id: reviewId },
      data: {
        status: state.status,
        currentNodeId: state.currentNodeId,
        currentRound: state.round,
      },
    });
  }
}

void DEFAULT_HARD_GATES; // 保留引用，避免未使用告警（默认闸由 resolveHardGates 内部使用）
void isTerminalStatus; // 保留引用（状态机判定工具，供外部/未来节点使用）
