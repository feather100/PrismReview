/**
 * reporting.service.ts — P5 ReportingService（Contract §5）
 *
 * 从 ReviewsService 抽取报告生成逻辑：getReport / buildReportFromDb / exportMarkdown /
 * renderScoringSection。新增：委托 ScoringService 计算加权评分并拼入 ReportResponseDto.scoring，
 * 在 export.md 追加"评分"小节（§5.4 格式）。
 *
 * 边界（Contract §5.3）：
 *  - CRUD / 状态机 / turn 执行 / Moderator 决策 仍归 ReviewsService / Orchestrator。
 *  - 评分 + 叙事 + 报告组装 + 导出 → 本 Service。
 *  - 审计红线：评分时把 snapshot 写 Review.scoringConfig（经 ScoringService.saveScoringResult）。
 */
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReportResponseDto, ReportScoringDto, ReportScoringDimension } from '../dto/report-response.dto';
import { ScoringService, ScoringResult } from '../scoring/scoring.service';
import { WorkflowRegistry } from '../../workflow/workflow.registry';
import type { AuthUser } from '../../../common/decorators/current-user.decorator';

@Injectable()
export class ReportingService {
  private readonly logger = new Logger(ReportingService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoringService: ScoringService,
    private readonly registry: WorkflowRegistry,
  ) {}

  async generateReport(reviewId: string, user: AuthUser): Promise<ReportResponseDto> {
    const review = await this.assertReview(reviewId, user.tenantId, [
      'running', 'interrupted', 'summarized', 'completed', 'failed',
    ]);

    const dbOpinions = await this.prisma.reviewOpinion.findMany({
      where: { reviewId },
      include: { turn: { select: { turnIndex: true } } },
      orderBy: { createdAt: 'asc' },
    });

    // 评分驱动：解析 workflow（旧 mode 值兼容映射到 preset），计算并持久化快照（审计红线）
    const config = this.registry.resolve(review.mode);
    const scoringResult = await this.scoringService.score(reviewId, config.id);
    await this.scoringService.saveScoringResult(reviewId, scoringResult);
    const scoring = this.toScoringDto(scoringResult, config.nameZh);

    let report: ReportResponseDto;
    if (dbOpinions.length > 0) {
      report = await this.buildReportFromDb(review, dbOpinions);
    } else {
      report = await this.buildMockReport(review, user);
    }

    report.scoring = scoring;
    return report;
  }

  async exportMarkdown(reviewId: string, user: AuthUser): Promise<string> {
    const review = await this.assertReview(reviewId, user.tenantId, ['completed']);
    const report = await this.generateReport(reviewId, user);

    const esc = (s: string) => (s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const verdictMap: Record<string, string> = { approved: '通过', conditionally_approved: '有条件通过', rejected: '不通过' };
    const verdictLabel = verdictMap[report.verdict] || '未给出';
    const ps = report.providerSummary;

    let md = '';
    md += '# PrismReview 评审报告\n\n';
    md += '**评审标题**: ' + esc(report.title) + '\n';
    md += '**评审目标**: ' + esc(report.objective) + '\n';
    md += '**Review ID**: ' + reviewId + '\n';
    md += '**状态**: ' + esc(report.status) + '\n';
    md += '**模式**: ' + esc(report.mode) + '\n';
    md += '**生成时间**: ' + new Date().toISOString() + '\n';
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

    // P5（§5.4）：追加"评分"小节（取完整 ScoringResult 以保留 riskPenalty / confidenceAvg）
    const config = this.registry.resolve(review.mode);
    const scoringResult = await this.scoringService.score(reviewId, config.id);
    await this.scoringService.saveScoringResult(reviewId, scoringResult);
    md += this.renderScoringSection(scoringResult);

    md += '---\n\n> 本报告由 PrismReview 自动生成\n';
    return md;
  }

  /** 评分驱动的报告 small-section（追加到 export.md，格式见 Contract §5.4）。 */
  renderScoringSection(result: ScoringResult): string {
    const t = result.configSnapshot.thresholds;
    const verdictMap: Record<string, string> = { approved: '通过', conditionally_approved: '有条件通过', rejected: '不通过' };
    const verdictLabel = verdictMap[result.verdict] || result.verdict;

    const riskLabel = (p: number) => (p === 0.5 ? 'high' : p === 0.8 ? 'medium' : 'low');

    let md = '---\n\n';
    md += `## 评分（workflow: ${result.workflowId}，阈值: ≥${t.approved}=通过 / ≥${t.conditionallyApproved}=有条件通过）\n\n`;
    md += '| 维度 | 权重 | 置信度均值 | 风险惩罚 | 加权得分 |\n|---|---|---|---|---|\n';
    for (const d of result.dimensionScores) {
      md += `| ${d.dimension} | ${d.weight} | ${d.confidenceAvg} | ×${d.riskPenalty} (${riskLabel(d.riskPenalty)}) | ${d.weightedScore} |\n`;
    }
    const totalWeight = result.dimensionScores.reduce((a, d) => a + d.weight, 0);
    md += `| **总分** | ${Number(totalWeight.toFixed(4))} | — | — | **${result.overallScore}** |\n\n`;
    md += `**结论**: ${verdictLabel}（分 ${result.overallScore} / 阈值 ${t.approved}）\n`;
    if (result.coverage.missing.length > 0) {
      md += `**缺失维度**: ${result.coverage.missing.join('、')}（配置中预期但未覆盖）\n`;
    }
    return md;
  }

  // ── 报告构建（从 ReviewsService 抽取，P1–P4 语义保持一致）──

  private async buildMockReport(review: any, user: AuthUser): Promise<ReportResponseDto> {
    // 注意：buildMockReport 仅用于无 DB opinions 的回退展示；维度对齐 enterprise preset，保证评分可视化有意义。
    void user;

    // 回退 mock opinion（维度对齐 enterprise preset，保证评分可视化有意义）
    const MOCK_OPINIONS: Array<{ dimension: string; riskLevel: string; issue: string; recommendation: string; confidenceScore: number }> = [
      { dimension: '架构合理性', riskLevel: 'high', issue: '核心链路未设置熔断降级机制，存在单点故障风险', recommendation: '采用微服务架构拆分关键模块，设置超时和熔断', confidenceScore: 78 },
      { dimension: '投入产出分析', riskLevel: 'medium', issue: '初期投入较高，长期ROI可期但需分阶段验证', recommendation: '制定分阶段投入计划，首阶段聚焦核心功能验证', confidenceScore: 72 },
      { dimension: '交付风险', riskLevel: 'medium', issue: '排期紧张，关键路径存在外部依赖风险', recommendation: '增加20%排期缓冲，明确外部依赖时间表', confidenceScore: 65 },
      { dimension: '数据安全与合规', riskLevel: 'high', issue: '方案涉及用户数据出境，需完成隐私影响评估', recommendation: '完成数据分类分级，确保数据加密传输和存储', confidenceScore: 80 },
      { dimension: '用户体验', riskLevel: 'low', issue: '学习成本偏高，缺乏新手引导', recommendation: '补充新手引导流程，优化关键页面加载性能', confidenceScore: 70 },
    ];

    const opinions = MOCK_OPINIONS.map((m, i) => ({
      dimension: m.dimension,
      agentCode: `角色${i + 1}`,
      agentName: `角色${i + 1}`,
      riskLevel: m.riskLevel,
      issue: m.issue,
      recommendation: m.recommendation,
      confidenceScore: m.confidenceScore,
    }));

    const risks = opinions.filter((o) => o.riskLevel === 'high' || o.riskLevel === 'medium').map((o) => ({
      title: o.issue.substring(0, 40),
      riskLevel: o.riskLevel,
      sourceAgent: o.agentCode,
      dimension: o.dimension,
      description: o.issue,
    }));
    const actionItems = opinions.map((o) => ({
      title: o.recommendation,
      sourceAgent: o.agentCode,
      priority: o.riskLevel === 'high' ? 'p0' : o.riskLevel === 'medium' ? 'p1' : 'p2',
      status: 'open',
    }));
    const lowConfidenceItems = opinions.filter((o) => o.confidenceScore < 65).map((o) => ({
      agentCode: o.agentCode,
      agentName: o.agentName,
      issue: o.issue,
      confidenceScore: o.confidenceScore,
    }));
    const verdict = opinions.some((o) => o.riskLevel === 'high') ? 'conditionally_approved' : 'approved';

    return {
      reviewId: review.id,
      title: review.title,
      objective: review.objective,
      status: review.status,
      mode: review.mode,
      source: 'mock_fallback',
      opinionCount: opinions.length,
      generatedFromTurns: false,
      narrative: await this.loadNarrative(review.id),
      providerSummary: { totalTurns: 0, bySource: { mock: opinions.length }, fallbackCount: 0, failedCount: 0, models: ['mock'], hasRealProvider: false },
      verdict,
      executiveSummary: `方案 "${review.title}" 经过 ${opinions.length} 个角色的评审，共识别 ${risks.length} 项风险。${lowConfidenceItems.length > 0 ? `其中 ${lowConfidenceItems.length} 条意见置信度较低，需人工确认。` : ''}`,
      metrics: {
        p0RiskCount: risks.filter((r) => r.riskLevel === 'high').length,
        totalRiskCount: risks.length,
        adoptionRate: Math.round(70 + Math.random() * 20),
        durationMinutes: opinions.length * 3,
        totalRoles: opinions.length,
      },
      risks,
      opinions,
      actionItems,
      lowConfidenceItems,
    };
  }

  private async buildReportFromDb(review: any, dbOpinions: any[]): Promise<ReportResponseDto> {
    const turnIds = [...new Set(dbOpinions.map((o) => o.turnId))];
    const turns = await this.prisma.reviewTurn.findMany({
      where: { id: { in: turnIds } },
      select: { id: true, roleVersionId: true },
    });
    const versionIds = [...new Set(turns.map((t) => t.roleVersionId))];
    const roles = await this.prisma.agentRole.findMany({
      where: { activeVersionId: { in: versionIds } },
      select: { code: true, name: true, activeVersionId: true },
    });
    const versionToRole = new Map(roles.map((r) => [r.activeVersionId, { code: r.code, name: r.name }]));
    const turnToRole = new Map(turns.map((t) => [t.id, versionToRole.get(t.roleVersionId) ?? { code: 'unknown', name: 'Unknown' }]));

    const opinions = dbOpinions.map((o) => {
      const role = turnToRole.get(o.turnId) ?? { code: 'unknown', name: 'Unknown' };
      return { dimension: o.dimension, agentCode: role.code, agentName: role.name, riskLevel: o.riskLevel, issue: o.issue, recommendation: o.recommendation, confidenceScore: o.confidenceScore };
    });

    const risks = opinions.filter((o) => o.riskLevel === 'high' || o.riskLevel === 'medium').map((o) => ({
      title: o.issue.substring(0, 40), riskLevel: o.riskLevel, sourceAgent: o.agentCode, dimension: o.dimension, description: o.issue,
    }));
    const actionItems = opinions.map((o) => ({
      title: o.recommendation, sourceAgent: o.agentCode, priority: o.riskLevel === 'high' ? 'p0' : o.riskLevel === 'medium' ? 'p1' : 'p2', status: 'open',
    }));
    const lowConfidenceItems = opinions.filter((o) => o.confidenceScore < 65).map((o) => ({
      agentCode: o.agentCode, agentName: o.agentName, issue: o.issue, confidenceScore: o.confidenceScore,
    }));
    const verdict = opinions.some((o) => o.riskLevel === 'high') ? 'conditionally_approved' : 'approved';

    return {
      reviewId: review.id, title: review.title, objective: review.objective, status: review.status, mode: review.mode,
      source: 'db_opinions',
      opinionCount: opinions.length,
      generatedFromTurns: true,
      narrative: await this.loadNarrative(review.id),
      providerSummary: this.buildProviderSummary(dbOpinions),
      verdict,
      executiveSummary: `方案 "${review.title}" 经过 ${opinions.length} 个角色的评审，共识别 ${risks.length} 项风险。${lowConfidenceItems.length > 0 ? `其中 ${lowConfidenceItems.length} 条意见置信度较低，需人工确认。` : ''}`,
      metrics: { p0RiskCount: risks.filter((r) => r.riskLevel === 'high').length, totalRiskCount: risks.length, adoptionRate: Math.round(70 + Math.random() * 20), durationMinutes: opinions.length * 3, totalRoles: opinions.length },
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
      try { if (o.modelOutputRef) ref = JSON.parse(o.modelOutputRef); } catch { /* ignore */ }
      const source = ref?.providerSource || 'mock';
      const isFallback = ref?.fallback === true;
      const isFailed = source === 'failed';
      bySource[source] = (bySource[source] || 0) + 1;
      if (isFallback) fallbackCount++;
      if (isFailed) failedCount++;
      if (ref?.modelName && !models.includes(ref.modelName)) models.push(ref.modelName);
    }
    return {
      totalTurns: dbOpinions.length,
      bySource,
      fallbackCount,
      failedCount,
      models,
      hasRealProvider: Object.keys(bySource).some((s) => s === 'lmstudio' || s === 'openai_compatible'),
    };
  }

  private toScoringDto(result: ScoringResult, workflowName: string): ReportScoringDto {
    const dimensionScores: ReportScoringDimension[] = result.dimensionScores.map((d) => ({
      dimension: d.dimension,
      weight: d.weight,
      weightedScore: d.weightedScore,
    }));
    return {
      workflowId: result.workflowId,
      workflowName,
      overallScore: result.overallScore,
      dimensionScores,
      verdict: result.verdict,
      adoptedRate: result.adoptedRate,
      coverage: result.coverage,
      thresholds: result.configSnapshot.thresholds,
    };
  }

  /** P4 (Sprint 5.2 T19)：叙事来源 —— 取最近一次 converge 的 ModeratorDecision.reasoning。 */
  private async loadNarrative(reviewId: string): Promise<string | undefined> {
    const dec = await this.prisma.moderatorDecision.findFirst({
      where: { reviewId, decisionType: 'converge' },
      orderBy: { round: 'desc' },
    });
    return dec?.reasoning ?? undefined;
  }

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
}
