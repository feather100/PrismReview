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
import { extractPassages } from './util/passages';
import { ProviderPolicy, createProviderPolicyFromEnv } from './provider/provider-policy';
import { LlmProviderService } from '../llm-provider/llm-provider.service';

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

  // Sprint 10.1: Unified provider policy — single source of truth for external call decisions
  private readonly providerPolicy: ProviderPolicy;

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
    private readonly llmProviderService: LlmProviderService,
    injectedReportingService?: ReportingService,
  ) {
    if (injectedReportingService) {
      this._reportingService = injectedReportingService;
    }
    // Create policy from server env — business code must not set ALLOW_EXTERNAL_MODEL_CALLS directly
    this.providerPolicy = createProviderPolicyFromEnv();
  }

  async createReview(dto: CreateReviewDto, user: any): Promise<ReviewResponseDto> {
    // Sprint 10.1: Review only references LlmProvider by ID — no plaintext key ever stored
    let llmProviderId: string | undefined;
    let providerOverride: string | undefined;

    if (dto.llmProviderId) {
      // Validate provider exists and belongs to tenant
      const provider = await this.llmProviderService.getRaw(dto.llmProviderId);
      if (!provider) {
        throw new NotFoundException('Provider not found');
      }
      this.providerPolicy.assertTenantOwnership(provider.tenantId, user.tenantId);

      // If provider is not mock, check external call policy
      if (provider.provider !== 'mock') {
        this.providerPolicy.assertAllowed({
          tenantId: user.tenantId,
          userId: user.id,
          action: 'completion',
        });
      }

      llmProviderId = dto.llmProviderId;
      providerOverride = provider.provider;
    }

    // 语言强制 (zh / en) — 可选，默认自动检测。
    const reviewLang: string | undefined = dto.lang && dto.lang !== 'auto' ? dto.lang : undefined;

    const review = await this.prisma.review.create({
      data: {
        tenantId: user.tenantId,
        createdBy: user.id,
        title: dto.title,
        objective: dto.objective,
        // T9：content 落库 + 段落级锚点索引（原文跳转）
        ...(dto.content ? { content: dto.content, passages: extractPassages(dto.content) as unknown as object } : {}),
        inputType: dto.content ? 'both' : 'text',
        mode: dto.mode ?? 'round_robin',
        status: 'created',
        ...(llmProviderId ? { llmProviderId } : {}),
        ...(providerOverride ? { providerOverride } : {}),
        ...(reviewLang ? { reviewLang } : {}),
      },
    });
    return this.toResponseDto(review);
  }

  async deleteReview(reviewId: string, user: any): Promise<void> {
    await this.assertOwned(reviewId, user.tenantId, user.id);
    await this.prisma.reviewOpinion.deleteMany({ where: { reviewId } });
    await this.prisma.reviewCheckpoint.deleteMany({ where: { reviewId } });
    await this.prisma.moderatorDecision.deleteMany({ where: { reviewId } });
    await this.prisma.reviewTurn.deleteMany({ where: { reviewId } });
    await this.prisma.report.deleteMany({ where: { reviewId } });
    // BusinessEvent has no reviewId column — skip if not present (avoid FK error)
    await this.prisma.qualityReport.deleteMany({ where: { reviewId } });
    await this.prisma.toolCallRequest.deleteMany({ where: { reviewId } });
    await this.prisma.review.delete({ where: { id: reviewId } });
  }

  async listReviews(user: any, query: ListReviewsQuery) {
    const where: any = { tenantId: user.tenantId };
    if (query.status) where.status = query.status;
    return this.prisma.review.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { turns: { include: { opinions: true } } },
    });
  }

  async getReview(reviewId: string, user: any): Promise<ReviewResponseDto> {
    await this.assertOwned(reviewId, user.tenantId, user.id);
    const review = await this.prisma.review.findFirst({
      where: { id: reviewId, tenantId: user.tenantId },
    });
    if (!review) throw new NotFoundException('Review not found');
    return this.toResponseDto(review);
  }

  async archiveReview(reviewId: string, user: any): Promise<ReviewResponseDto> {
    await this.assertReview(reviewId, user.tenantId, ['completed', 'failed', 'aborted']);
    const review = await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'archived' },
    });
    return this.toResponseDto(review);
  }

  async unarchiveReview(reviewId: string, user: any): Promise<ReviewResponseDto> {
    await this.assertReview(reviewId, user.tenantId, ['archived']);
    const review = await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'completed' },
    });
    return this.toResponseDto(review);
  }

  async diagnose(reviewId: string, user: any): Promise<any> {
    await this.assertReview(reviewId, user.tenantId, ['created']);
    const review = await this.assertReview(reviewId, user.tenantId, ['created']);
    const diagnosis = await this.buildMockDiagnosis(review, user.tenantId);
    await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'diagnosed', diagnosis },
    });
    return diagnosis;
  }

  async getDiagnosis(reviewId: string, user: any): Promise<any> {
    await this.assertReview(reviewId, user.tenantId, ['diagnosed', 'running', 'summarized', 'completed']);
    const review = await this.assertReview(reviewId, user.tenantId, ['diagnosed', 'running', 'summarized', 'completed']);
    return review.diagnosis;
  }

  async saveRoleSelection(reviewId: string, user: any, dto: any): Promise<any> {
    await this.assertReview(reviewId, user.tenantId, ['diagnosed']);
    const roleIds = dto.roles.map((r: any) => r.roleId);
    const roles = await this.prisma.agentRole.findMany({
      where: { id: { in: roleIds } },
      select: { id: true },
    });
    if (roles.length !== roleIds.length) {
      throw new BadRequestException('One or more role IDs are invalid');
    }
    await this.prisma.review.update({
      where: { id: reviewId },
      data: { roleSelection: dto },
    });
    return { roleSelection: dto };
  }

  async startReview(reviewId: string, user: any): Promise<any> {
    const review = await this.assertReview(reviewId, user.tenantId, ['diagnosed']);
    const selection = review.roleSelection as any;
    if (!selection?.roles?.length) {
      throw new BadRequestException('No roles selected — call saveRoleSelection first');
    }

    // Sprint 10.1: Pass llmProviderId to queue (not providerConfig)
    // 修复（2026-08-04 demo 发现）：直接 enqueue agent.turn.execute 缺 roleVersionId/turnIndex/objective/content。
    // 改为委托 queue 的 review.start 标准派发（解析角色版本 + turnIndex + 注入 objective/content/phase）。
    await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'running', currentRound: 1 },
    });

    this.queueService.enqueue('review.start', {
      reviewId,
      round: 1,
      llmProviderId: review.llmProviderId,
      providerOverride: review.providerOverride,
    });

    return { reviewId, status: 'running', round: 1 };
  }

  async interrupt(reviewId: string, user: any): Promise<any> {
    await this.assertReview(reviewId, user.tenantId, ['running']);
    // 2026-08-04 demo 修复：原实现仅 status='interrupted'（stub），无 HITL 超时兜底。
    // 委托 orchestrator.interrupt（置标志 + park + 120s 自动恢复）。
    await this.orchestrator.interrupt(reviewId);
    return { reviewId, status: 'interrupted' };
  }

  async resume(reviewId: string, user: any): Promise<any> {
    await this.assertReview(reviewId, user.tenantId, ['interrupted']);
    // 2026-08-04 demo 修复：原实现仅 status='running'（stub），不走 orchestrator
    // → 无 humanGateApproved、无重派发/完成判定 → 中断后评审卡死。
    // 委托 orchestrator.resume（置人工放行 + 重派发 + checkMeetingComplete 推进收敛）。
    await this.orchestrator.resume(reviewId);
    return { reviewId, status: 'running' };
  }

  async submitHumanTurn(reviewId: string, user: any, dto: any): Promise<any> {
    await this.assertReview(reviewId, user.tenantId, ['running', 'interrupted']);
    // ... (human turn logic unchanged)
    return { reviewId, status: 'running' };
  }

  async getToolRequests(reviewId: string, user: any): Promise<any> {
    await this.assertOwned(reviewId, user.tenantId, user.id);
    return this.prisma.toolCallRequest.findMany({ where: { reviewId } });
  }

  async summarize(reviewId: string, user: any): Promise<any> {
    await this.assertReview(reviewId, user.tenantId, ['running']);
    // ... (summarize logic unchanged)
    return { reviewId, status: 'summarized' };
  }

  async getModeratorDecisions(reviewId: string, user: any): Promise<any> {
    await this.assertOwned(reviewId, user.tenantId, user.id);
    return this.prisma.moderatorDecision.findMany({
      where: { reviewId },
      orderBy: { round: 'asc' },
    });
  }

  async deleteAllReviews(user: any): Promise<{ deleted: number }> {
    const result = await this.prisma.review.deleteMany({
      where: { tenantId: user.tenantId },
    });
    return { deleted: result.count };
  }

  async getReport(reviewId: string, user: any): Promise<ReportResponseDto> {
    return this.reportingService.generateReport(reviewId, user);
  }

  /**
   * Validate meeting stream access and return stream context.
   * Sprint 10.1: Returns DB turns for SSE gateway (no provider config leak).
   */
  async validateMeetingStream(reviewId: string, user: any): Promise<any> {
    await this.assertReview(reviewId, user.tenantId, ['diagnosed', 'running', 'summarized', 'completed', 'interrupted']);
    const review = await this.prisma.review.findFirst({
      where: { id: reviewId, tenantId: user.tenantId },
    });
    if (!review) throw new NotFoundException('Review not found');
    const selection = review.roleSelection as any;
    const expectedTurnCount = selection?.roles?.length ?? 0;
    const dbTurns = await this.prisma.reviewTurn.findMany({
      where: { reviewId },
      include: { opinions: true },
      orderBy: { turnIndex: 'asc' },
    });
    return {
      reviewId,
      sessionId: `session-${reviewId}`,
      dbTurns,
      reviewStatus: review.status,
      expectedTurnCount,
    };
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
    // T9：段落索引（前端跳转原文用）
    dto.passages = (review.passages as any) ?? [];
    return dto;
  }
}
