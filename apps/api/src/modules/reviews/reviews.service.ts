import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from './queue/queue.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { ListReviewsQuery } from './dto/list-reviews-query.dto';
import { ReviewResponseDto, DiagnosisResponseDto } from './dto/review-response.dto';
import { ReportResponseDto } from './dto/report-response.dto';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
  ) {}

  async createReview(dto: CreateReviewDto, user: any): Promise<ReviewResponseDto> {
    const review = await this.prisma.review.create({
      data: {
        tenantId: user.tenantId,
        createdBy: user.id,
        title: dto.title,
        objective: dto.objective,
        inputType: dto.content ? 'both' : 'text',
        mode: dto.mode ?? 'round_robin',
        status: 'created',
      },
    });
    return this.toResponseDto(review);
  }

  async listReviews(user: any, query: ListReviewsQuery) {
    const where: any = { tenantId: user.tenantId, createdBy: user.id };
    if (query.status) where.status = query.status;
    if (query.mode) where.mode = query.mode;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.offset,
        take: query.limit,
      }),
      this.prisma.review.count({ where }),
    ]);

    return {
      items: items.map(r => this.toResponseDto(r)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
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

    // Enqueue review.start job (Sprint 4.2 — in-memory mock queue)
    const sessionId = `session-${reviewId}`;
    this.queueService.enqueue('review.start', { reviewId, sessionId });

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
    await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'interrupted' },
    });
    return { status: 'interrupted' };
  }

  async resume(reviewId: string, user: any) {
    await this.assertReview(reviewId, user.tenantId, ['interrupted']);
    await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'running' },
    });
    return { status: 'running' };
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

  // ── Report (Mock) ──

  async getReport(reviewId: string, user: any): Promise<ReportResponseDto> {
    const review = await this.assertReview(reviewId, user.tenantId, ['running', 'interrupted', 'summarized', 'completed', 'failed']);

    // Check if real opinions exist in DB (written by agent turn runner)
    const dbOpinions = await this.prisma.reviewOpinion.findMany({
      where: { reviewId },
      include: { turn: { select: { turnIndex: true } } },
      orderBy: { createdAt: 'asc' },
    });

    if (dbOpinions.length > 0) {
      return this.buildReportFromDb(review, dbOpinions);
    }

    // Fallback: build mock report from roleSelection
    const roleIds = (review.roleSelection as any)?.roles?.map((r: any) => r.roleId) ?? [];
    const roles = await this.prisma.agentRole.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, code: true, name: true },
    });

    // Build mock opinions per role
    const MOCK_OPINIONS: Record<string, { dimension: string; riskLevel: string; issue: string; recommendation: string; confidenceScore: number }> = {
      CTO: { dimension: '架构合理性', riskLevel: 'high', issue: '核心链路未设置熔断降级机制，存在单点故障风险', recommendation: '采用微服务架构拆分关键模块，设置超时和熔断', confidenceScore: 78 },
      CFO: { dimension: '投入产出分析', riskLevel: 'medium', issue: '初期投入较高，长期ROI可期但需分阶段验证', recommendation: '制定分阶段投入计划，首阶段聚焦核心功能验证', confidenceScore: 72 },
      PMO: { dimension: '交付风险', riskLevel: 'medium', issue: '排期紧张，关键路径存在外部依赖风险', recommendation: '增加20%排期缓冲，明确外部依赖时间表', confidenceScore: 65 },
      Compliance: { dimension: '数据安全与合规', riskLevel: 'high', issue: '方案涉及用户数据出境，需完成隐私影响评估', recommendation: '完成数据分类分级，确保数据加密传输和存储', confidenceScore: 80 },
      UserAdvocate: { dimension: '用户体验', riskLevel: 'low', issue: '学习成本偏高，缺乏新手引导', recommendation: '补充新手引导流程，优化关键页面加载性能', confidenceScore: 70 },
    };

    const opinions = roles.map(r => {
      const m = MOCK_OPINIONS[r.code] || MOCK_OPINIONS.CTO;
      return { dimension: m.dimension, agentCode: r.code, agentName: r.name, riskLevel: m.riskLevel, issue: m.issue, recommendation: m.recommendation, confidenceScore: m.confidenceScore };
    });

    const risks = opinions.filter(o => o.riskLevel === 'high' || o.riskLevel === 'medium').map(o => ({
      title: o.issue.substring(0, 40),
      riskLevel: o.riskLevel,
      sourceAgent: o.agentCode,
      dimension: o.dimension,
      description: o.issue,
    }));

    const actionItems = opinions.map(o => ({
      title: o.recommendation,
      sourceAgent: o.agentCode,
      priority: o.riskLevel === 'high' ? 'p0' : o.riskLevel === 'medium' ? 'p1' : 'p2',
      status: 'open',
    }));

    const lowConfidenceItems = opinions.filter(o => o.confidenceScore < 65).map(o => ({
      agentCode: o.agentCode,
      agentName: o.agentName,
      issue: o.issue,
      confidenceScore: o.confidenceScore,
    }));

    const verdict = opinions.some(o => o.riskLevel === 'high') ? 'conditionally_approved' : 'approved';

    const report: ReportResponseDto = {
      reviewId: review.id,
      title: review.title,
      objective: review.objective,
      status: review.status,
      mode: review.mode,
      source: 'mock_fallback',
      opinionCount: opinions.length,
      generatedFromTurns: false,
      providerSummary: { totalTurns: 0, bySource: { mock: opinions.length }, fallbackCount: 0, failedCount: 0, models: ['mock'], hasRealProvider: false },
      verdict,
      executiveSummary: `方案 "${review.title}" 经过 ${roles.length} 个角色的评审，共识别 ${risks.length} 项风险。${lowConfidenceItems.length > 0 ? `其中 ${lowConfidenceItems.length} 条意见置信度较低，需人工确认。` : ''}`,
      metrics: {
        p0RiskCount: risks.filter(r => r.riskLevel === 'high').length,
        totalRiskCount: risks.length,
        adoptionRate: Math.round(70 + Math.random() * 20),
        durationMinutes: roles.length * 3,
        totalRoles: roles.length,
      },
      risks,
      opinions,
      actionItems,
      lowConfidenceItems,
    };

    return report;
  }

  /**
   * Build report from DB opinions (written by agent turn runner).
   */
  private async buildReportFromDb(review: any, dbOpinions: any[]): Promise<ReportResponseDto> {
    const turnIds = [...new Set(dbOpinions.map(o => o.turnId))];
    const turns = await this.prisma.reviewTurn.findMany({
      where: { id: { in: turnIds } },
      select: { id: true, roleVersionId: true },
    });
    const versionIds = [...new Set(turns.map(t => t.roleVersionId))];
    const roles = await this.prisma.agentRole.findMany({
      where: { activeVersionId: { in: versionIds } },
      select: { code: true, name: true, activeVersionId: true },
    });
    const versionToRole = new Map(roles.map(r => [r.activeVersionId, { code: r.code, name: r.name }]));
    const turnToRole = new Map(turns.map(t => [t.id, versionToRole.get(t.roleVersionId) ?? { code: 'unknown', name: 'Unknown' }]));

    const opinions = dbOpinions.map(o => {
      const role = turnToRole.get(o.turnId) ?? { code: 'unknown', name: 'Unknown' };
      return { dimension: o.dimension, agentCode: role.code, agentName: role.name, riskLevel: o.riskLevel, issue: o.issue, recommendation: o.recommendation, confidenceScore: o.confidenceScore };
    });

    const risks = opinions.filter(o => o.riskLevel === 'high' || o.riskLevel === 'medium').map(o => ({
      title: o.issue.substring(0, 40), riskLevel: o.riskLevel, sourceAgent: o.agentCode, dimension: o.dimension, description: o.issue,
    }));
    const actionItems = opinions.map(o => ({
      title: o.recommendation, sourceAgent: o.agentCode, priority: o.riskLevel === 'high' ? 'p0' : o.riskLevel === 'medium' ? 'p1' : 'p2', status: 'open',
    }));
    const lowConfidenceItems = opinions.filter(o => o.confidenceScore < 65).map(o => ({
      agentCode: o.agentCode, agentName: o.agentName, issue: o.issue, confidenceScore: o.confidenceScore,
    }));
    const verdict = opinions.some(o => o.riskLevel === 'high') ? 'conditionally_approved' : 'approved';

    return {
      reviewId: review.id, title: review.title, objective: review.objective, status: review.status, mode: review.mode,
      source: 'db_opinions',
      opinionCount: opinions.length,
      generatedFromTurns: true,
      providerSummary: this.buildProviderSummary(dbOpinions),
      verdict,
      executiveSummary: `方案 "${review.title}" 经过 ${opinions.length} 个角色的评审，共识别 ${risks.length} 项风险。${lowConfidenceItems.length > 0 ? `其中 ${lowConfidenceItems.length} 条意见置信度较低，需人工确认。` : ''}`,
      metrics: { p0RiskCount: risks.filter(r => r.riskLevel === 'high').length, totalRiskCount: risks.length, adoptionRate: Math.round(70 + Math.random() * 20), durationMinutes: opinions.length * 3, totalRoles: opinions.length },
      risks, opinions, actionItems, lowConfidenceItems,
    };
  }

  private buildProviderSummary(dbOpinions: any[]): any {
    const bySource: Record<string, number> = {};
    const models: string[] = [];
    let fallbackCount = 0;
    let failedCount = 0;

    for (const o of dbOpinions) {
      let ref: any = null;
      try {
        if (o.modelOutputRef) ref = JSON.parse(o.modelOutputRef);
      } catch (e: any) {
        this.logger.warn(`modelOutputRef parse error: ${e.message}`);
      }
      const source = ref?.providerSource || 'mock';
      const isFallback = ref?.fallback === true;
      const isFailed = source === 'failed';

      bySource[source] = (bySource[source] || 0) + 1;
      if (isFallback) fallbackCount++;
      if (isFailed) failedCount++;
      if (ref?.modelName && !models.includes(ref.modelName)) models.push(ref.modelName);
    }

    const providerSummary = {
      totalTurns: dbOpinions.length,
      bySource,
      fallbackCount,
      failedCount,
      models,
      hasRealProvider: Object.keys(bySource).some(s => s === 'lmstudio' || s === 'openai_compatible'),
    };
    return providerSummary;
  }

  async exportMarkdown(reviewId: string, user: any): Promise<string> {
    const review = await this.assertReview(reviewId, user.tenantId, ['completed']);
    const report = await this.getReport(reviewId, user);

    const esc = (s: string) => (s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const verdictMap: Record<string, string> = { approved: '通过', conditionally_approved: '有条件通过', rejected: '不通过' };
    const verdictLabel = verdictMap[report.verdict] || '未给出';
    const generatedAt = new Date().toISOString();
    const ps = report.providerSummary;

    let md = '';
    md += '# PrismReview 评审报告\n\n';
    md += '**评审标题**: ' + esc(report.title) + '\n';
    md += '**评审目标**: ' + esc(report.objective) + '\n';
    md += '**Review ID**: ' + reviewId + '\n';
    md += '**状态**: ' + esc(report.status) + '\n';
    md += '**模式**: ' + esc(report.mode) + '\n';
    md += '**生成时间**: ' + generatedAt + '\n';
    md += '**数据来源**: ' + esc(report.source) + '\n';
    md += '**意见数量**: ' + report.opinionCount + '\n';
    md += '**真实生成**: ' + (report.generatedFromTurns ? '是' : '否（Mock 模拟）') + '\n\n';

    md += '---\n\n## 评审结论\n\n**结论**: ' + verdictLabel + '\n\n';

    if (ps) {
      md += '## 生成来源摘要\n\n';
      md += '- 总轮次: ' + ps.totalTurns + '\n';
      md += '- Mock 生成: ' + (ps.bySource?.mock || 0) + '\n';
      md += '- LM Studio: ' + (ps.bySource?.lmstudio || 0) + '\n';
      md += '- 外部模型: ' + (ps.bySource?.openai_compatible || 0) + '\n';
      md += '- 回退 Mock: ' + ps.fallbackCount + '\n';
      md += '- 失败: ' + ps.failedCount + '\n';
      md += '- 使用模型: ' + (ps.models?.join(', ') || 'N/A') + '\n\n';
    }

    md += '---\n\n## 执行摘要\n\n' + esc(report.executiveSummary) + '\n\n';
    md += '---\n\n## 评审指标\n\n';
    md += '- P0 风险数: ' + report.metrics.p0RiskCount + '\n';
    md += '- 风险总数: ' + report.metrics.totalRiskCount + '\n';
    md += '- 建议采纳率: ' + report.metrics.adoptionRate + '%\n';
    md += '- 评审耗时: ' + report.metrics.durationMinutes + ' 分钟\n';
    md += '- 参审角色: ' + report.metrics.totalRoles + '\n\n';

    if (report.risks.length > 0) {
      md += '---\n\n## 风险清单\n\n| # | 风险等级 | 来源 | 维度 | 描述 |\n|---|---|---|---|---|\n';
      report.risks.forEach((r, i) => md += '| ' + (i + 1) + ' | ' + esc(r.riskLevel) + ' | ' + esc(r.sourceAgent) + ' | ' + esc(r.dimension) + ' | ' + esc(r.description) + ' |\n');
      md += '\n';
    }

    if (report.opinions.length > 0) {
      md += '---\n\n## 各角色评审意见\n\n';
      for (const o of report.opinions) {
        md += '### ' + esc(o.agentCode) + ' (' + esc(o.agentName) + ')\n';
        md += '- 维度: ' + esc(o.dimension) + '\n';
        md += '- 风险等级: ' + esc(o.riskLevel) + '\n';
        md += '- 核心问题: ' + esc(o.issue) + '\n';
        md += '- 改进建议: ' + esc(o.recommendation) + '\n';
        md += '- 置信度: ' + o.confidenceScore + '%\n\n';
      }
    }

    if (report.actionItems.length > 0) {
      md += '---\n\n## 改进行动项\n\n| # | 优先级 | 来源 | 标题 |\n|---|---|---|---|\n';
      report.actionItems.forEach((a, i) => md += '| ' + (i + 1) + ' | ' + esc(a.priority) + ' | ' + esc(a.sourceAgent) + ' | ' + esc(a.title) + ' |\n');
      md += '\n';
    }

    if (report.lowConfidenceItems.length > 0) {
      md += '---\n\n## 低置信度意见（需人工确认）\n\n| # | 角色 | 意见 | 置信度 |\n|---|---|---|---|\n';
      report.lowConfidenceItems.forEach((l, i) => md += '| ' + (i + 1) + ' | ' + esc(l.agentName) + ' | ' + esc(l.issue) + ' | ' + l.confidenceScore + '% |\n');
      md += '\n';
    }

    md += '---\n\n> 本报告由 PrismReview 自动生成\n';
    return md;
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
