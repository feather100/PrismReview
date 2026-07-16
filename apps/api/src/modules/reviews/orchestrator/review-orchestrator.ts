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
import { Injectable, Logger, OnModuleInit, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { createProviderAdapter } from '../provider/provider-factory';
import {
  Graph,
  Node,
  NodeCtx,
  ReviewState,
  ModeratorDecisionType,
  isTerminalStatus,
} from './graph-runtime';
import { PostgresCheckpointer } from './postgres-checkpointer';
import { MODERATOR_TOKEN, Moderator, HardGates, DEFAULT_HARD_GATES, toDecisionRef } from './moderator';
import { resolveHardGates } from './hard-gates';
import { WorkflowRegistry, WorkflowConfig } from '../../workflow/workflow.registry';
import { PromptServiceImpl } from '../../prompt/prompt.service';
import { MemoryServiceImpl } from '../../memory/memory.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';

/**
 * P2-3（9.5a）+ 9.5b 须知悉项 1 & 3：summarized 节点的下一节点由
 * ModeratorDecision.decisionType 动态决定（条件路由，非硬编码）：
 *   - converge / terminate_proposal → completed（收敛/终止提议通过）
 *   - force_stop                 → aborted（硬闸/收敛 override 强停）
 *   - advance_round / continue_debate → running（round-2 入口；9.5b 接管 round-2 派发）
 *     · advance_round：minRounds 未达标（9.5a P2-2）→ 继续到下一轮
 *     · continue_debate：存在 high-risk 冲突 → 派发 round-2 debate turns
 *     两者在 9.5b 均触发 currentRound++ + round-N 派发（多轮循环）。
 */
type NextNode = 'completed' | 'aborted' | 'running' | 'tool_node' | 'pending_defense';

const DEFENSE_MAX = 2; // max tours de défense utilisateur

function routeAfterSummarized(type: ModeratorDecisionType, defenseCount: number): NextNode {
  switch (type) {
    case 'ask_user_defense':
      return defenseCount < DEFENSE_MAX ? 'pending_defense' : 'completed';
    case 'converge':
    case 'terminate_proposal':
      return 'completed';
    case 'force_stop':
      return 'aborted';
    case 'advance_round':
    case 'continue_debate':
      return 'running';
    case 'tool_approval':
    case 'propose_tool':
      return 'tool_node'; // P4/P5 Tool 节点（stub）
    default:
      return 'running';
  }
}

@Injectable()
export class ReviewOrchestrator implements OnModuleInit {
  private readonly logger = new Logger(ReviewOrchestrator.name);
  private readonly graph: Graph<ReviewState>;
  /** HITL：跟踪在跑评审的暂停标志（P4 Sprint 5.2，§3.3）。 */
  private readonly runningReviews = new Map<string, { interrupted: boolean }>();
  /** HITL 超时自动恢复 timers（防 LLM 卡死导致 review 永久卡在 interrupted）。 */
  private readonly interruptTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** HITL 中断超时（默认 120s）；超过未 resume → 自动恢复并审计。 */
  private readonly INTERRUPT_TIMEOUT_MS = Number(process.env.INTERRUPT_TIMEOUT_MS) || 120_000;

  constructor(
    private readonly queue: QueueService,
    private readonly prisma: PrismaService,
    private readonly checkpointer: PostgresCheckpointer,
    @Inject(MODERATOR_TOKEN) private readonly moderator: Moderator,
    // P5 (Sprint 5.3)：WorkflowRegistry 用于 resolve(review.mode) → 配置驱动各节点参数。
    // 默认自实例化：兼容手动 `new ReviewOrchestrator(...)`（回归脚本的 4 参旧签名）；Nest DI 时注入真实实例。
    private readonly workflowRegistry: WorkflowRegistry = new WorkflowRegistry(),
    // P3 注入位（NodeCtx 等价）：真实服务由模块装配注入；手动 `new ReviewOrchestrator(...)` 时为 undefined → 跳过 memory 聚合。
    private readonly promptService?: PromptServiceImpl,
    private readonly memoryService?: MemoryServiceImpl,
    private readonly knowledgeService?: KnowledgeService,
  ) {
    this.graph = this.buildGraph();
  }

  /** 模块初始化：把 queue 的完成回调接到编排脊柱（single-round converge）。 */
  async onModuleInit(): Promise<void> {
    this.queue.completionHook = (reviewId: string) => this.handleTurnsComplete(reviewId);
    this.logger.log('ReviewOrchestrator wired to QueueService.completionHook');
    // F2：崩溃恢复 —— 扫描 DB 中 status='interrupted' 的 review，重建内存标志 + 重挂 120s 超时兜底 timer。
    await this.recoverInterruptedReviews();
  }

  /**
   * F2 崩溃恢复：进程重启后，从 review 表状态重建 interrupted 标志并重新挂上
   * 120s 超时自动恢复 timer。幂等：已存在的 entry 不重复注册（clearInterruptTimer 防重）。
   */
  private async recoverInterruptedReviews(): Promise<void> {
    const interrupted = await this.prisma.review.findMany({
      where: { status: 'interrupted' },
      select: { id: true, currentRound: true },
    });
    if (interrupted.length === 0) return;
    for (const r of interrupted) {
      // 幂等：重复 recover 不产生副作用（Map.set 覆盖同一值，timer 会被 clearInterruptTimer 先清）
      this.runningReviews.set(r.id, { interrupted: true });
      this.scheduleInterruptTimeout(r.id, r.currentRound ?? 1);
    }
    this.logger.warn(
      `F2 recovery: re-armed HITL timeout for ${interrupted.length} interrupted review(s) ` +
        `(INTERRUPT_TIMEOUT_MS=${this.INTERRUPT_TIMEOUT_MS}ms)`,
    );
  }

  /** 模块销毁：清理所有 pending HITL timeout timers（防内存泄漏）。 */
  onModuleDestroy(): void {
    for (const timer of this.interruptTimers.values()) {
      clearTimeout(timer);
    }
    this.interruptTimers.clear();
    this.runningReviews.clear();
  }

  private get ctx(): NodeCtx {
    return {
      logger: this.logger,
      tracer: undefined, // P1 仅 stub
      checkpointer: this.checkpointer,
      queue: this.queue,
      prisma: this.prisma,
      // Sprint 2.1: modelAdapter injected at module assembly (P2 节点就绪位)
      modelAdapter: createProviderAdapter(),
      // P3 注入位：替代 undefined，由模块装配注入（Contract §5.2）
      promptService: this.promptService,
      memoryService: this.memoryService,
      knowledgeService: this.knowledgeService,
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
      // P4 (Sprint 5.2) Tool 节点 stub：消费 pendingToolCalls（ToolCallRequest ids），调用 ToolRegistry.executeTool。
      // 默认 MockModerator 不触发 tool_approval，故该节点在生产默认配置下不会被路由进入。
      tool_node: async (state) => ({
        status: 'summarized',
        currentNodeId: 'tool_node',
        pendingToolCalls: state.pendingToolCalls,
      }),
      // P4 (Sprint 5.2) HITL 暂停节点 stub：写 checkpoint + 空转等待 resume。
      interrupted: async () => ({ status: 'interrupted', currentNodeId: 'interrupted' }),
      // Défense : attente que l'utilisateur soumette sa défense / complément.
      pending_defense: async () => ({ status: 'summarized', currentNodeId: 'pending_defense' }),
    };
    // F1/F3 显式状态转移表（由 orchestrator 方法硬编码驱动，非 edges 数组遍历）：
    //   created      ──▶ diagnosed                     （start 起点）
    //   diagnosed    ──▶ running                       （nodeRunning 派发 round-1）
    //   running      ──▶ summarized                    （handleTurnsComplete：Moderator 决策）
    //   summarized   ──▶ completed | aborted | running | tool_node | pending_defense
    //                                   （routeAfterSummarized(s.lastDecisionType, defenseCount)）
    //   running      ──▶ failed                        （执行异常）
    //   tool_node    ──▶ summarized                    （tool_approval stub）
    //   interrupted  ──▶ running | summarized          （resume / human_override；标志位内存保存 + F2 崩溃恢复）
    // 终态闭集（graph-runtime TERMINAL_STATUSES）：completed / failed / aborted / archived。
    return {
      nodes,
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
    this.runningReviews.set(reviewId, { interrupted: false });
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
    // P5 (Sprint 5.3)：resolve workflow 配置 → maxRounds/minRounds 覆盖硬闸默认值
    const config = await this.resolveWorkflowConfig(state.reviewId);
    const gates = resolveHardGates({ maxRounds: config.maxRounds, minRounds: config.minRounds });
    // 硬闸：max_rounds（代码强制）。单轮 round=1 远未触顶，但检查存在。
    if (state.round > gates.maxRounds) {
      this.logger.warn(
        `max_rounds breached (round=${state.round} > maxRounds=${gates.maxRounds}) → force_stop`,
      );
      return { status: 'aborted', currentNodeId: 'aborted' };
    }

    // HITL：若已被 interrupt，则暂停本轮派发（不新派发 turn，交由 orchestrator.interrupt park）
    if (this.runningReviews.get(state.reviewId)?.interrupted) {
      this.logger.log(`nodeRunning: review ${state.reviewId.substring(0, 8)} interrupted → park, skip dispatch`);
      return { status: 'interrupted', currentNodeId: 'interrupted', round: state.round };
    }

    // 派发 round-1 并行 reviewer turns（包装 QueueService；review.start 内部按角色派发）
    // P2-1：显式携带 round（= state.round = review.currentRound），贯通到 turn 写入，
    // 避免 9.5 round-2 时全部错发 round=1 + 幂等键冲突。
    // P5：携带 workflow.turnPhasePattern → queue 按 round 决定 phase（§6.3）。
    this.queue.enqueue('review.start', {
      reviewId: state.reviewId,
      sessionId: `session-${state.reviewId}`,
      round: state.round,
      turnPhasePattern: config.turnPhasePattern,
    });

    return { status: 'running', currentNodeId: 'running', round: state.round };
  }

  /** P5：resolve workflow 配置（review.mode → preset，兼容旧值）；失败兜底 enterprise。 */
  private async resolveWorkflowConfig(reviewId: string): Promise<WorkflowConfig> {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { mode: true },
    });
    return this.workflowRegistry.resolve(review?.mode ?? 'enterprise');
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

    // HITL：interrupt 标志置位 → 不收敛，直接 park 到 interrupted（真正暂停，不触发 Moderator 决策）
    if (this.runningReviews.get(reviewId)?.interrupted) {
      const st = await this.buildState(reviewId);
      const interruptedState: ReviewState = {
        ...st,
        status: 'interrupted',
        currentNodeId: 'interrupted',
        updatedAt: new Date().toISOString(),
      };
      await this.checkpoint(reviewId, 'interrupted', interruptedState);
      await this.persistState(reviewId, interruptedState);
      this.logger.log(`handleTurnsComplete: review ${reviewId.substring(0, 8)} interrupted flag → parked (no converge)`);
      return;
    }

    const state = await this.buildState(reviewId);
    // P5 (Sprint 5.3)：resolve workflow 配置 → 驱动 maxRounds / debateAfterRound / 门控
    const config = this.workflowRegistry.resolve(review.mode);
    const gates: HardGates = resolveHardGates({ maxRounds: config.maxRounds, minRounds: config.minRounds });

    // summarized 节点：运行 MockModerator（传入 workflow 配置做 debateAfterRound 门控）
    const decision = await this.moderator.decide(state, gates, config);
    const summarizedState: ReviewState = {
      ...state,
      status: 'summarized',
      currentNodeId: 'summarized',
      moderatorDecisions: [...state.moderatorDecisions, toDecisionRef(decision)],
      convergenceScore: decision.decisionType === 'converge' ? 1 : 0,
      lastDecisionType: decision.decisionType, // P2-3：供 summarized 条件边读取
      updatedAt: new Date().toISOString(),
    };
    await this.checkpoint(reviewId, 'summarized', summarizedState);
    await this.persistState(reviewId, summarizedState);

    // --- Boucle de défense : si le Moderator demande la défense, on attend l'utilisateur ---
    if (decision.decisionType === 'ask_user_defense' && (state.defenseCount ?? 0) < DEFENSE_MAX) {
      // Enregistrer la demande de défense côté DB (côté frontend poll la dernière décision via API)
      await this.prisma.review.update({
        where: { id: reviewId },
        data: { defenseCount: (state.defenseCount ?? 0) + 1 },
      });
      this.logger.log(`[Defense] review ${reviewId.substring(0, 8)} ask_user_defense (round ${state.round}, defense #${(state.defenseCount ?? 0) + 1}) — waiting for user input`);
      // Émettre l'événement SSE "defense.requested"
      this.emitDefenseEvent(reviewId, decision);
      return; // on reprendra après soumission de la défense utilisateur
    }

    // P3：summarized 节点聚合 Memory（蒸馏 profile + project memory）；
    // 多轮 round≥3 触发滚动压缩。失败不阻塞主流程（catch 兜底，T17）。
    if (this.memoryService) {
      try {
        await this.memoryService.updateReviewerProfile(reviewId);
        await this.memoryService.updateProjectMemory(reviewId);
        if (state.round >= 3) {
          await this.memoryService.compressRoundContext(reviewId, state.round);
        }
      } catch (e: any) {
        this.logger.warn(`Memory aggregation failed (non-blocking): ${e?.message}`);
      }
    }

    // P2-3：条件路由 —— summarized 的下一节点由 decide() 结果决定（非硬编码 completed）
    const next = routeAfterSummarized(decision.decisionType, state.defenseCount ?? 0);
    const rid = reviewId.substring(0, 8);

    if (next === 'aborted') {
      const abortedState: ReviewState = {
        ...summarizedState,
        status: 'aborted',
        currentNodeId: 'aborted',
        updatedAt: new Date().toISOString(),
      };
      await this.checkpoint(reviewId, 'aborted', abortedState);
      await this.persistState(reviewId, abortedState);
      this.cleanupReview(reviewId);
      this.logger.log(`Spine: review ${rid} force_stop → aborted`);
      return;
    }

    if (next === 'running') {
      // 9.5b 须知悉项 1 & 3：advance_round / continue_debate → round-2 (N) 派发（多轮循环）。
      const nextRound = state.round + 1;

      // 须知悉项 2：每轮派发前重校验 max_rounds（防御性双闸；Moderator 已在 round>=maxRounds 返回 force_stop）。
      if (nextRound > gates.maxRounds) {
        const abortedState: ReviewState = {
          ...summarizedState,
          status: 'aborted',
          currentNodeId: 'aborted',
          updatedAt: new Date().toISOString(),
        };
        await this.checkpoint(reviewId, 'aborted', abortedState);
        await this.persistState(reviewId, abortedState);
        this.cleanupReview(reviewId);
        this.logger.log(
          `Spine: review ${rid} nextRound ${nextRound} > maxRounds ${gates.maxRounds} → force_stop → aborted`,
        );
        return;
      }

      // 进入 running(round-N)：推进 currentRound + 派发 round-N debate turns（包装 QueueService）。
      const runningState: ReviewState = {
        ...summarizedState,
        status: 'running',
        currentNodeId: 'running',
        round: nextRound,
        updatedAt: new Date().toISOString(),
      };
      await this.checkpoint(reviewId, 'running', runningState);
      await this.persistState(reviewId, runningState); // 写 currentRound=nextRound, status=running

      // 派发 round-N turns（review.start 内部按角色派发，round=nextRound 贯通到 turn 写入 + 幂等键）。
      // P5：携带 workflow.turnPhasePattern → queue 按 round 决定 phase（§6.3）。
      this.queue.enqueue('review.start', {
        reviewId: state.reviewId,
        sessionId: `session-${state.reviewId}-r${nextRound}`,
        round: nextRound,
        turnPhasePattern: config.turnPhasePattern,
      });
      this.logger.log(
        `Spine: review ${rid} decision=${decision.decisionType} → running(round-${nextRound}) dispatched (multi-round)`,
      );
      return;
    }

    // next === 'completed'（converge / terminate_proposal）
    const completedState: ReviewState = {
      ...summarizedState,
      status: 'completed',
      currentNodeId: 'completed',
      updatedAt: new Date().toISOString(),
    };
    await this.checkpoint(reviewId, 'completed', completedState);
    await this.persistState(reviewId, completedState);
    this.cleanupReview(reviewId);
    this.logger.log(`Spine complete: review ${rid} → completed (decision=${decision.decisionType})`);
  }

  /** Emit SSE 'defense.requested' to connected clients. */
  private emitDefenseEvent(reviewId: string, decision: { reasoning?: string; round?: number }) {
    try {
      const payload = JSON.stringify({ type: 'defense.requested', reviewId, reasoning: decision.reasoning ?? '', round: decision.round ?? 0, ts: new Date().toISOString() });
      // Notify gateway subscribers
      const gw = (globalThis as any).__prismGateway;
      if (gw?.emit) gw.emit(reviewId, payload);
    } catch { /* ignore SSE errors */ }
  }

  /** Démarrer un round de défense après soumission utilisateur. */
  async startDefenseRound(reviewId: string, defenseContent: string, targetExpert?: string): Promise<void> {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new Error(`Review ${reviewId} not found`);
    const round = review.currentRound ?? 1;
    const sessionId = `session-${reviewId}-defense-${review.defenseCount ?? 1}`;
    // Re-dispatch round-N avec mention de la défense (le contenu est lu depuis review.last_defense à l'exécution du turn)
    this.queue.enqueue('review.start', {
      reviewId,
      sessionId,
      round,
      turnPhasePattern: undefined,
      defenseContext: defenseContent,
      targetMention: targetExpert,
    });
    this.logger.log(`[Defense] review ${reviewId.substring(0, 8)} round-${round} restarted (defense #${review.defenseCount ?? 1}, target=${targetExpert ?? 'all'})`);
  }

  /**
   * 清理 review 的运行时状态（终态时调用，防止内存泄漏）。
   *  - 删除 runningReviews 中断标志
   *  - 清理 queue.service.processedIds 中该 review 的 jobId 前缀
   */
  private cleanupReview(reviewId: string): void {
    this.runningReviews.delete(reviewId);
    this.clearInterruptTimer(reviewId);
    // 清理 queue.processedIds（以 reviewId 为前缀的 job）
    try {
      const prefix = `${reviewId}`;
      for (const id of this.queue.getProcessedIds()) {
        if (id.includes(prefix)) this.queue.deleteProcessedId(id);
      }
    } catch (e: any) {
      this.logger.warn(`cleanupReview processedIds sweep: ${e?.message}`);
    }
  }

  /**
   * 崩溃恢复：从最新 checkpoint 的 currentNodeId resume。
   *  - running：重派发 pending turns（幂等）+ 重查完成（幂等）
   *  - summarized：直接走 handleTurnsComplete（补完成）
   */
  /**
   * HITL 暂停（P4 §3.3）：真正闭合的中断。
   *  - 置 runningReviews 标志，阻止下一轮 turn 派发（nodeRunning 阻断）。
   *  - 若当前 running，则 park 到 interrupted（checkpoint + status 翻牌 + 审计 ModeratorDecision('tool_approval')）。
   */
  async interrupt(reviewId: string): Promise<void> {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) return;

    // 1. 置标志，阻止后续 turn 派发
    const entry = this.runningReviews.get(reviewId) ?? { interrupted: false };
    entry.interrupted = true;
    this.runningReviews.set(reviewId, entry);

    // 2. 仅运行态才 park；否则仅置标志（等下次 handleTurnsComplete 阻断）
    if (review.status !== 'running') {
      this.logger.log(`interrupt: review ${reviewId.substring(0, 8)} not running (${review.status}); flag set only`);
      return;
    }

    const state = await this.buildState(reviewId);
    const interruptedState: ReviewState = {
      ...state,
      status: 'interrupted',
      currentNodeId: 'interrupted',
      updatedAt: new Date().toISOString(),
    };
    await this.checkpoint(reviewId, 'interrupted', interruptedState);
    await this.persistState(reviewId, interruptedState);

    // 3. 审计：ModeratorDecision('tool_approval', 'HITL manual interrupt')
    await this.prisma.moderatorDecision.create({
      data: {
        reviewId,
        round: state.round,
        decisionType: 'tool_approval',
        reasoning: 'HITL manual interrupt',
        ruleCheckResult: { interrupted: true } as unknown as object,
      },
    });

    // 4. 超时兜底：若 LLM/turn 卡死导致 review 永久 interrupted → 自动 resume + audit
    this.scheduleInterruptTimeout(reviewId, state.round);

    this.logger.log(`interrupt: review ${reviewId.substring(0, 8)} → interrupted (flag set, parked)`);
  }

  /**
   * HITL 超时兜底（P5 修复 P2）：超时未 resume → 自动恢复并审计。
   * 防止 LLM turn 卡死 / 网络断连导致 review 永久卡在 interrupted。
   */
  private scheduleInterruptTimeout(reviewId: string, round: number): void {
    this.clearInterruptTimer(reviewId);
    const timer = setTimeout(async () => {
      try {
        const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
        if (!review || review.status !== 'interrupted') return; // 已被 resume 或删除
        this.logger.warn(`HITL timeout auto-resume: review ${reviewId.substring(0, 8)} (after ${this.INTERRUPT_TIMEOUT_MS}ms)`);
        await this.prisma.moderatorDecision.create({
          data: {
            reviewId,
            round,
            decisionType: 'tool_approval',
            reasoning: `HITL timeout auto-resume (${this.INTERRUPT_TIMEOUT_MS}ms exceeded)`,
            ruleCheckResult: { autoResumed: true } as unknown as object,
          },
        });
        await this.resume(reviewId);
      } catch (e: any) {
        this.logger.error(`HITL timeout auto-resume failed: ${e?.message}`);
      }
    }, this.INTERRUPT_TIMEOUT_MS);
    this.interruptTimers.set(reviewId, timer);
  }

  private clearInterruptTimer(reviewId: string): void {
    const timer = this.interruptTimers.get(reviewId);
    if (timer) {
      clearTimeout(timer);
      this.interruptTimers.delete(reviewId);
    }
  }

  /**
   * HITL 恢复（P4 §3.3）：从 interrupted 续跑。
   *  - 非 interrupted 态 → 400（BadRequestException）。
   *  - 清标志 + checkpoint running + status 翻牌 + 重派发当前轮 turns（幂等）。
   */
  async resume(reviewId: string): Promise<void> {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) return;
    if (review.status !== 'interrupted') {
      throw new BadRequestException(
        `review ${reviewId.substring(0, 8)} is not in 'interrupted' state; cannot resume (current: ${review.status})`,
      );
    }

    // 1. 清中断标志 + 清超时 timer
    const entry = this.runningReviews.get(reviewId) ?? { interrupted: false };
    entry.interrupted = false;
    this.runningReviews.set(reviewId, entry);
    this.clearInterruptTimer(reviewId);

    // 2. checkpoint running + status 翻牌
    const state = await this.buildState(reviewId);
    const runningState: ReviewState = {
      ...state,
      status: 'running',
      currentNodeId: 'running',
      updatedAt: new Date().toISOString(),
    };
    await this.checkpoint(reviewId, 'running', runningState);
    await this.persistState(reviewId, runningState);

    // 3. 从中断点续跑：重派发当前轮 turns（幂等；已完成 skip）
    this.queue.enqueue('review.start', {
      reviewId: state.reviewId,
      sessionId: `session-${state.reviewId}-resume`,
      round: state.round,
    });
    this.logger.log(`resume: review ${reviewId.substring(0, 8)} → running (r${state.round} redispatched)`);
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
      mentionExpertCode?: string | null;
      mentionDirection?: string | null;
      defenseCount?: number;
    };

    return {
      reviewId,
      status: review.status as ReviewState['status'],
      round: reviewAny.currentRound ?? 1,
      currentNodeId: reviewAny.currentNodeId ?? 'running',
      mentionExpertCode: reviewAny.mentionExpertCode ?? undefined,
      mentionDirection: reviewAny.mentionDirection ?? undefined,
      defenseCount: reviewAny.defenseCount ?? 0,
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
        defenseCount: state.defenseCount ?? 0,
      },
    });
  }
}

void DEFAULT_HARD_GATES; // 保留引用，避免未使用告警（默认闸由 resolveHardGates 内部使用）
void isTerminalStatus; // 保留引用（状态机判定工具，供外部/未来节点使用）
