import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from './queue/queue.service';
import { ReviewOrchestrator } from './orchestrator';
import { ToolRegistryImpl } from '../tool/tool.registry';
import { CreateReviewDto } from './dto/create-review.dto';
import { ListReviewsQuery } from './dto/list-reviews-query.dto';
import { ReviewResponseDto, DiagnosisResponseDto } from './dto/review-response.dto';
import { ReportResponseDto } from './dto/report-response.dto';
import { ReportingService } from './reporting/reporting.service';
import { ScoringService } from './scoring/scoring.service';
import { WorkflowRegistry } from '../workflow/workflow.registry';

// P1 status flow (Contract §1.2). Enum renamed per §7.6:
//   draft/diagnosing→created, ready→diagnosed, summarizing→summarized; aborted added.
// interrupted/archived retained as non-normative补充态 (HITL pause / archive flag).
// NOTE: this constant is documentation of the allowed transitions; the actual
// guards are the `assertReview(allowedStatuses)` calls below, which were updated
// to the same P1 spec.
const REVIEW_STATUS_FLOW: Record<string, string[]> = {
  created: ['diagnosed'],                                     // diagnose() 完成诊断 + saveRoleSelection()
  diagnosed: ['running'],                                     // startReview() 派发 round-1 turns
  running: ['summarized', 'interrupted', 'failed'],           // 本轮 turns 终态 + Moderator 汇总 / HITL 暂停 / 执行失败
  summarized: ['running', 'completed', 'aborted', 'failed'], // round-2 / 收敛达标 / max_rounds 硬闸 / 执行失败
  completed: [],                                              // 终态
  failed: [],                                                 // 终态
  aborted: [],                                                // 终态（硬闸/收敛 override 强停）
  interrupted: ['running'],                                    // resume() 恢复
  archived: [],                                               // 生命周期标志（终态后归档）
};

// Mock seed role IDs (must match what seed.ts creates)
const MOCK_ROLES = [
  { id: 'mock-cto-id', code: 'CTO', name: '技术审核员', type: 'preset' },
  { id: 'mock-cfo-id', code: 'CFO', name: '商业控制者', type: 'preset' },
  { id: 'mock-pmo-id', code: 'PMO', name: '交付守护者', type: 'preset' },
  { id: 'mock-compliance-id', code: 'Compliance', name: '合规审查员', type: 'preset' },
  { id: 'mock-ua-id', code: 'UserAdvocate', name: '用户代言人', type: 'preset' },
];

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  // 向后兼容：Nest DI 注入真实 ReportingService；手动 new（旧测试）走懒初始化
  private _reportingService?: ReportingService;
  private get reportingService(): ReportingService {
    if (!this._reportingService) {
      const wf = new WorkflowRegistry();
      const scoring = new ScoringService(this.prisma, wf);
      this._reportingService = new ReportingService(this.prisma, scoring, wf);
    }
    return this._reportingService;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly orchestrator: ReviewOrchestrator,
    private readonly toolRegistry: ToolRegistryImpl,
    injectedReportingService?: ReportingService,
  ) {
    if (injectedReportingService) {
      this._reportingService = injectedReportingService;
    }
  }

  async createReview(dto: CreateReviewDto, user: any): Promise<ReviewResponseDto> {
    // 产品化：per-review provider override（可选）。apiKey 仅写入 DB，绝不外泄。
    const providerOverride: string | undefined = dto.provider?.provider;
    const providerConfig: any = (dto.provider && dto.provider.provider !== 'mock')
      ? {
          model: dto.provider.model,
          baseUrl: dto.provider.baseUrl,
          apiKey: dto.provider.apiKey,
        }
      : undefined;
    // 语言强制 (zh / en) — 可选，默认自动检测。
    const reviewLang: string | undefined = dto.lang && dto.lang !== 'auto' ? dto.lang : undefined;

    const review = await this.prisma.review.create({
      data: {
        tenantId: user.tenantId,
        createdBy: user.id,
        title: dto.title,
        objective: dto.objective,
        inputType: dto.content ? 'both' : 'text',
        mode: dto.mode ?? 'round_robin',
        status: 'created',
        ...(providerOverride ? { providerOverride } : {}),
        ...(providerConfig ? { providerConfig } : {}),
        ...(reviewLang ? { reviewLang } : {}),
      },
    });
    return this.toResponseDto(review);
  }

  async listReviews(user: any, query: ListReviewsQuery) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const offset = typeof query.offset === 'number' ? query.offset : (page - 1) * limit;

    // Tenant + ownership isolation (沿用既有 tenant 隔离)
    const where: any = { tenantId: user.tenantId, createdBy: user.id };

    // status 筛选：支持多值 "completed,failed" → WHERE status IN (...)
    if (query.status) {
      const statuses = query.status
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      if (statuses.length) where.status = { in: statuses };
    } else {
      // 默认列表隐藏已归档项（"我的评审"聚焦活跃评审；
      // 仅当用户显式筛选 status=archived 时才展示归档项）。
      where.status = { not: 'archived' };
    }
    if (query.mode) where.mode = query.mode;

    // search：title / objective 模糊匹配（Postgres 下 mode:'insensitive' → ILIKE）
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { objective: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.review.count({ where }),
    ]);

    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

    return {
      items: items.map(r => this.toResponseDto(r)),
      total,
      page,
      limit,
      totalPages,
      offset,
    };
  }

  /**
   * Archive a review. Allowed source statuses: completed / failed / aborted.
   * A `running` review is first interrupted (HITL pause) and then archived.
   * Ownership is enforced via tenantId + createdBy.
   */
  async archiveReview(reviewId: string, user: any): Promise<ReviewResponseDto> {
    const review = await this.assertOwned(reviewId, user.tenantId, user.id);

    let currentStatus = review.status;
    if (currentStatus === 'running') {
      // 运行中先中断（HITL 暂停），再归档
      await this.prisma.review.update({
        where: { id: reviewId },
        data: { status: 'interrupted' },
      });
      currentStatus = 'interrupted';
    }

    const ARCHIVE_ALLOWED = ['completed', 'failed', 'aborted', 'interrupted'];
    if (!ARCHIVE_ALLOWED.includes(currentStatus)) {
      throw new BadRequestException(
        `Review status "${currentStatus}" cannot be archived. Allowed: completed, failed, aborted, running (auto-interrupt).`,
      );
    }

    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'archived' },
    });
    this.logger.log(`Review ${reviewId} archived (was ${currentStatus})`);
    return this.toResponseDto(updated);
  }

  /**
   * Unarchive a review. Restores an `archived` review back to `completed`
   * (business-sensible default: archived items are typically finished reviews
   * whose report should remain viewable). No schema change required.
   */
  async unarchiveReview(reviewId: string, user: any): Promise<ReviewResponseDto> {
    const review = await this.assertOwned(reviewId, user.tenantId, user.id);

    if (review.status !== 'archived') {
      throw new BadRequestException(
        `Review status "${review.status}" is not archived; cannot unarchive.`,
      );
    }

    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'completed' },
    });
    this.logger.log(`Review ${reviewId} unarchived → completed`);
    return this.toResponseDto(updated);
  }

  async getReview(reviewId: string, user: any): Promise<ReviewResponseDto> {
    const review = await this.prisma.review.findFirst({
      where: { id: reviewId, tenantId: user.tenantId },
    });
    if (!review) throw new NotFoundException('Review not found');
    return this.toResponseDto(review);
  }

  // ── Diagnose (Mock) ──

  async diagnose(reviewId: string, user: any): Promise<{ taskId: string }> {
    const review = await this.assertReview(reviewId, user.tenantId, ['created']);

    // Update status to created (diagnosing folded into created per §7.6; no-op
    // write that preserves the diagnose() two-step structure)
    await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'created' },
    });

    // Build mock diagnosis — query real role IDs from DB
    const mockDiagnosis = await this.buildMockDiagnosis(review, user.tenantId);

    await this.prisma.review.update({
      where: { id: reviewId },
      data: {
        diagnosis: mockDiagnosis as any,
        status: 'diagnosed',
      },
    });

    return { taskId: `mock-diagnosis-${reviewId}` };
  }

  async getDiagnosis(reviewId: string, user: any): Promise<DiagnosisResponseDto | null> {
    const review = await this.prisma.review.findFirst({
      where: { id: reviewId, tenantId: user.tenantId },
    });
    if (!review) throw new NotFoundException('Review not found');
    if (!review.diagnosis) return null;

    const diagnosis = review.diagnosis as any;

    // Enrich with removable flag
    // Query actual roles to determine type
    const roleIds = diagnosis.recommendedRoles?.map((r: any) => r.roleId) ?? [];
    const roles = await this.prisma.agentRole.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, type: true },
    });
    const roleTypeMap = new Map(roles.map(r => [r.id, r.type]));

    return {
      summary: diagnosis.summary,
      tags: diagnosis.tags,
      radarDimensions: diagnosis.radarDimensions,
      confidenceScore: diagnosis.confidenceScore,
      recommendedRoles: (diagnosis.recommendedRoles ?? []).map((r: any) => ({
        ...r,
        removable: roleTypeMap.get(r.roleId) !== 'preset',
      })),
    };
  }

  // ── Role Selection ──

  async saveRoleSelection(reviewId: string, user: any, dto: any) {
    const review = await this.assertReview(reviewId, user.tenantId, ['diagnosed']);

    // Validate all roleIds exist
    const roleIds = dto.roles.map((r: any) => r.roleId);
    const validRoles = await this.prisma.agentRole.findMany({
      where: { id: { in: roleIds }, tenantId: user.tenantId, status: 'enabled' },
    });
    if (validRoles.length !== roleIds.length) {
      throw new BadRequestException('One or more roles not found or disabled');
    }

    await this.prisma.review.update({
      where: { id: reviewId },
      data: {
        roleSelection: { roles: dto.roles } as any,
      },
    });

    // Return enriched role selection
    return this.getEnrichedRoleSelection(reviewId, user.tenantId);
  }

  // ── State Machine Actions ──

  async startReview(reviewId: string, user: any) {
    const review = await this.assertReview(reviewId, user.tenantId, ['diagnosed']);
    if (!review.roleSelection) {
      throw new BadRequestException('Role selection required before starting');
    }

    await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'running' },
    });

    // 走编排脊柱（P1 编排核心）：派发 round-1 并行 reviewer turns（包装 QueueService）
    // + 每节点写 checkpoint；全部 turn 终态后由 QueueService.completionHook
    // 触发 Moderator converge → completed。
    const sessionId = `session-${reviewId}`;
    await this.orchestrator.start(reviewId);

    return { sessionId, status: 'running' };
  }

  /**
   * Validate that a review is ready for meeting stream.
   * Returns DB turns if they exist, otherwise returns enriched role selection for mock SSE.
   */
  async validateMeetingStream(reviewId: string, user: any) {
    const review = await this.assertReview(reviewId, user.tenantId, ['running', 'completed']);

    // Check if DB turns exist (from queue/runner)
    const dbTurns = await this.prisma.reviewTurn.findMany({
      where: { reviewId },
      include: { opinions: true },
      orderBy: { turnIndex: 'asc' },
    });

    if (dbTurns.length > 0) {
      const versionIds = [...new Set(dbTurns.map(t => t.roleVersionId).filter(Boolean))];
      const roles = await this.prisma.agentRole.findMany({
        where: { activeVersionId: { in: versionIds } },
        select: { id: true, code: true, name: true, activeVersionId: true },
      });
      const versionToRole = new Map(roles.map(r => [r.activeVersionId, { id: r.id, code: r.code, name: r.name }]));

      const enrichedTurns = dbTurns.map(t => ({
        turnId: t.id,
        turnIndex: t.turnIndex,
        roleCode: versionToRole.get(t.roleVersionId)?.code ?? 'unknown',
        roleName: versionToRole.get(t.roleVersionId)?.name ?? 'Unknown',
        roleId: versionToRole.get(t.roleVersionId)?.id ?? '',
        status: t.status,
        startedAt: t.startedAt?.toISOString?.() ?? null,
        completedAt: t.completedAt?.toISOString?.() ?? null,
        opinion: t.opinions[0] ? {
          dimension: t.opinions[0].dimension,
          riskLevel: t.opinions[0].riskLevel,
          issue: t.opinions[0].issue,
          recommendation: t.opinions[0].recommendation,
          confidenceScore: t.opinions[0].confidenceScore,
        } : null,
      }));

      return {
        sessionId: `session-${reviewId}`,
        dbTurns: enrichedTurns,
        reviewStatus: review.status,
        expectedTurnCount: (review.roleSelection as any)?.roles?.length ?? 0,
      };
    }

    // Fallback to mock
    if (!review.roleSelection) {
      throw new BadRequestException('Role selection required before streaming meeting events');
    }

    const enriched = await this.getEnrichedRoleSelection(reviewId, user.tenantId);
    if (!enriched.roles || enriched.roles.length === 0) {
      throw new BadRequestException('No roles configured for this review');
    }

    return { sessionId: `session-${reviewId}`, roles: enriched.roles };
  }

  async interrupt(reviewId: string, user: any) {
    await this.assertReview(reviewId, user.tenantId, ['running']);
    // 真正暂停：交 orchestrator 置标志 + park（DB 翻牌由 orchestrator.interrupt 完成）
    await this.orchestrator.interrupt(reviewId);
    return { status: 'interrupted' };
  }

  async resume(reviewId: string, user: any) {
    await this.assertReview(reviewId, user.tenantId, ['interrupted']);
    // 真正恢复：交 orchestrator 续跑（清标志 + 翻牌 + 重派发）
    await this.orchestrator.resume(reviewId);
    return { status: 'running' };
  }

  /**
   * P4 Human Turn Override（Sprint 5.2 §3.4）：人类评审员手动注入意见（source='human'）。
   *
   *  - assert 评审处于 running / interrupted。
   *  - 同 round 已提交过（幂等键 .r{round}::human）→ 幂等 skip（T15）。
   *  - 创建 ReviewTurn(phase='human', status='completed') + 每条 ReviewOpinion(source='human')。
   *  - interrupted 态 → 自动 orchestrator.resume（T14）；否则触发 meeting 完成检查（T13）。
   */
  async submitHumanTurn(
    reviewId: string,
    user: any,
    dto: { round: number; opinions: Array<{
      dimension: string; riskLevel: string; issue: string;
      recommendation: string; confidenceScore: number; citations?: unknown;
    }> },
  ): Promise<{ status: string; reviewId: string; turnId: string; opinionCount: number }> {
    const review = await this.assertReview(reviewId, user.tenantId, ['running', 'interrupted']);
    const round = dto.round;

    // 幂等：同 round 的 human turn 已存在 → skip（T15）
    const idemKey = `${reviewId}::human::${round}`;
    const existing = await this.prisma.reviewTurn.findFirst({ where: { reviewId, idempotencyKey: idemKey } });
    if (existing) {
      const opin = await this.prisma.reviewOpinion.findMany({ where: { turnId: existing.id } });
      return { status: review.status, reviewId, turnId: existing.id, opinionCount: opin.length };
    }

    const turnIndex = (await this.prisma.reviewTurn.count({ where: { reviewId } })) + 1;
    const turn = await this.prisma.reviewTurn.create({
      data: {
        reviewId,
        turnIndex,
        phase: 'human',
        // 人类走独立通道，非 reviewer 角色版本。roleVersionId 仅为 Uuid 列（无 FK 约束，Contract §5.3 不触碰 ReviewTurn），
        // 用合法 UUID 占位，避免 Prisma Uuid 校验报错；语义身份由 idempotencyKey(::human::) 区分。
        roleVersionId: randomUUID(),
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
        round,
        idempotencyKey: idemKey,
      },
    });
    for (const op of dto.opinions) {
      await this.prisma.reviewOpinion.create({
        data: {
          reviewId,
          turnId: turn.id,
          dimension: op.dimension,
          riskLevel: op.riskLevel,
          issue: op.issue,
          recommendation: op.recommendation,
          citations: (op.citations as unknown) ?? [],
          confidenceScore: op.confidenceScore,
          reasoningSummary: 'human override',
          modelOutputRef: JSON.stringify({ providerSource: 'human' }),
          source: 'human',
        },
      });
    }

    if (review.status === 'interrupted') {
      // T14：interrupted 态自动 resume（orchestrator.resume 会清标志 + 续跑 + 触发 summarize）
      await this.orchestrator.resume(reviewId);
      return { status: 'running', reviewId, turnId: turn.id, opinionCount: dto.opinions.length };
    }

    // T13：触发 meeting 完成检查（若本轮 turns 齐 → 触发 summarize 流）
    await this.queueService.checkMeetingComplete(reviewId);
    return { status: 'human_turn_recorded', reviewId, turnId: turn.id, opinionCount: dto.opinions.length };
  }

  /** P4（Sprint 5.2 T21）：返回某评审的工具调用审批日志（ToolCallRequest）。 */
  async getToolRequests(reviewId: string, user: any) {
    await this.assertReview(reviewId, user.tenantId, ['running', 'interrupted', 'summarized', 'completed']);
    const log = await this.toolRegistry.getApprovalLog(reviewId);
    return { reviewId, toolRequests: log };
  }

  async summarize(reviewId: string, user: any) {
    await this.assertReview(reviewId, user.tenantId, ['running', 'interrupted']);
    await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'summarized' },
    });
    // Mock: immediately complete
    await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'completed' },
    });
    return { status: 'completed' };
  }

  // ── Report (P5：委托 ReportingService) ──

  /**
   * @deprecated 自 Sprint 5.3 起委托 ReportingService.generateReport()（30 天 back-compat 包装）。
   * 报告生成 / 评分 / 导出逻辑已抽取到 ReportingService。
   */
  async getModeratorDecisions(reviewId: string, user: any) {
    await this.assertOwned(reviewId, user.tenantId, user.id);
    const records = await this.prisma.moderatorDecision.findMany({
      where: { reviewId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, round: true, decisionType: true, reasoning: true, createdAt: true },
    });
    return records;
  }

  async getState(reviewId: string, user: any) {
    await this.assertOwned(reviewId, user.tenantId, user.id);
    const r = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!r) throw new NotFoundException('Review not found');
    const lastDecision = await this.prisma.moderatorDecision.findFirst({
      where: { reviewId }, orderBy: { createdAt: 'desc' },
      select: { decisionType: true, reasoning: true, round: true },
    });
    return {
      reviewId: r.id,
      status: r.status,
      round: r.currentRound,
      defenseCount: r.defenseCount,
      mentionExpertCode: r.mentionExpertCode,
      mentionDirection: r.mentionDirection,
      lastDecision,
      awaitingUserDefense: r.status === 'summarized' && lastDecision?.decisionType === 'ask_user_defense',
    };
  }

  async setMention(reviewId: string, user: any, expertCode: string, direction?: string) {
    await this.assertReview(reviewId, user.tenantId, ['diagnosed', 'created']);
    return this.prisma.review.update({
      where: { id: reviewId },
      data: { mentionExpertCode: expertCode, mentionDirection: direction ?? null },
      select: { id: true, mentionExpertCode: true, mentionDirection: true },
    });
  }

  async submitDefense(reviewId: string, user: any, content: string, targetExpert?: string) {
    const review = await this.assertReview(reviewId, user.tenantId, ['summarized']);
    if (!content?.trim()) throw new BadRequestException('Defense content required');

    // Stocker la défense dans last_defense + incrémenter defenseCount
    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: {
        lastDefense: { content, targetExpert: targetExpert ?? null, round: review.currentRound, at: new Date().toISOString() },
        defenseCount: (review.defenseCount ?? 0) + 1,
        status: 'running',
        currentRound: (review.currentRound ?? 1) + 1,
      },
    });

    // Déclencher un nouveau round avec le contexte de la défense
    const sessionId = `session-${reviewId}-defense-${updated.defenseCount}`;
    await this.orchestrator.startDefenseRound(reviewId, content, targetExpert);

    return { reviewId, status: 'running', round: updated.currentRound, defenseCount: updated.defenseCount, sessionId };
  }

  async getReport(reviewId: string, user: any): Promise<ReportResponseDto> {
    return this.reportingService.generateReport(reviewId, user);
  }

  /**
   * @deprecated 自 Sprint 5.3 起委托 ReportingService.exportMarkdown()（30 天 back-compat 包装）。
   */
  async exportMarkdown(reviewId: string, user: any): Promise<string> {
    return this.reportingService.exportMarkdown(reviewId, user);
  }

  // ── Helpers ──

  private async assertReview(reviewId: string, tenantId: string, allowedStatuses: string[]) {
    const review = await this.prisma.review.findFirst({
      where: { id: reviewId, tenantId },
    });
    if (!review) throw new NotFoundException('Review not found');
    if (!allowedStatuses.includes(review.status)) {
      throw new BadRequestException(
        `Review status "${review.status}" does not allow this operation. Allowed: ${allowedStatuses.join(', ')}`,
      );
    }
    return review;
  }

  /**
   * Ownership check: the review must belong to the caller's tenant AND be
   * created by the caller (so "我的评审" stays per-user, not just per-tenant).
   */
  private async assertOwned(reviewId: string, tenantId: string, userId: string) {
    const review = await this.prisma.review.findFirst({
      where: { id: reviewId, tenantId, createdBy: userId },
    });
    if (!review) throw new NotFoundException('Review not found');
    return review;
  }

  private async getEnrichedRoleSelection(reviewId: string, tenantId: string) {
    const review = await this.prisma.review.findFirst({
      where: { id: reviewId, tenantId },
    });
    if (!review?.roleSelection) return { roles: [] };

    const selection = review.roleSelection as any;
    const roleIds = selection.roles.map((r: any) => r.roleId);
    const roles = await this.prisma.agentRole.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, code: true, name: true, type: true },
    });
    const roleMap = new Map(roles.map(r => [r.id, r]));

    return {
      roles: selection.roles.map((r: any) => {
        const role = roleMap.get(r.roleId);
        return {
          roleId: r.roleId,
          roleCode: role?.code ?? 'unknown',
          roleName: role?.name ?? 'Unknown',
          weight: r.weight,
          removable: role?.type !== 'preset',
        };
      }),
    };
  }

  private async buildMockDiagnosis(review: any, tenantId: string): Promise<any> {
    // Query real roles from DB by code, so saveRoleSelection finds valid IDs
    const roleCodes = ['CTO', 'CFO', 'PMO', 'Compliance', 'UserAdvocate'];
    const roles = await this.prisma.agentRole.findMany({
      where: { tenantId, code: { in: roleCodes }, status: 'enabled' },
      select: { id: true, code: true, name: true },
    });

    if (roles.length !== roleCodes.length) {
      const missing = roleCodes.filter(c => !roles.find(r => r.code === c));
      throw new BadRequestException(
        `Preset roles not seeded. Run pnpm prisma:seed first. Missing: ${missing.join(', ')}`,
      );
    }

    const roleMap = new Map(roles.map(r => [r.code, r]));

    const recommendedRoles = [
      { code: 'CTO', name: '技术审核员', weight: 30, reason: '涉及高并发架构，需要技术可行性评估' },
      { code: 'CFO', name: '商业控制者', weight: 20, reason: '需要评估投入产出与商业风险' },
      { code: 'PMO', name: '交付守护者', weight: 20, reason: '识别排期与资源依赖风险' },
      { code: 'Compliance', name: '合规审查员', weight: 15, reason: '涉及数据合规与安全制度' },
      { code: 'UserAdvocate', name: '用户代言人', weight: 15, reason: '评估用户体验影响与认知负荷' },
    ].map(r => {
      const dbRole = roleMap.get(r.code);
      return {
        roleId: dbRole!.id,
        roleCode: r.code,
        roleName: dbRole!.name,
        weight: r.weight,
        reason: r.reason,
      };
    });

    return {
      summary: `方案 "${review.title}" 涉及 ${review.objective}。系统自动识别以下风险维度。`,
      tags: ['架构设计', '技术可行性', '高并发'],
      radarDimensions: [
        { name: '架构合理性', score: 72 },
        { name: '技术可行性', score: 85 },
        { name: '性能与扩展性', score: 45 },
        { name: '安全与合规', score: 68 },
        { name: '成本效益', score: 80 },
      ],
      confidenceScore: 82,
      recommendedRoles,
    };
  }

  private toResponseDto(review: any): ReviewResponseDto {
    const dto = new ReviewResponseDto();
    dto.id = review.id;
    dto.title = review.title;
    dto.objective = review.objective;
    dto.status = review.status;
    dto.mode = review.mode;
    dto.inputType = review.inputType;
    dto.createdBy = review.createdBy;
    dto.createdAt = review.createdAt?.toISOString?.() ?? review.createdAt;
    dto.updatedAt = review.updatedAt?.toISOString?.() ?? review.updatedAt;
    return dto;
  }
}
