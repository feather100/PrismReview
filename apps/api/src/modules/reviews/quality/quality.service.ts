/**
 * quality.service.ts — Provider quality evaluation service (Sprint 4.0)
 *
 * Evaluates model output quality by computing aggregated metrics from
 * ReviewOpinion records: confidence stats, dimension coverage, risk
 * distribution, and cross-run consistency (batch mode).
 *
 * Red-lines:
 *   - Does NOT modify orchestrator core dispatch logic.
 *   - Does NOT modify the ModelAdapter interface.
 *   - Default is mock; real providers only via explicit env.
 *   - External providers in batch mode are capped at MODEL_PILOT_MAX_ROLES (≤3).
 *   - No secrets are written or logged.
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReviewsService } from '../reviews.service';
import { createProviderAdapter, ProviderEnv } from '../provider/provider-factory';
import {
  ModelAdapter,
  SYSTEM_PROMPT,
  parseModelOpinion,
} from '../provider/model-adapter';

// ── Constants ──

/** The 5 standard review dimensions (from preset roles). */
const EXPECTED_DIMENSIONS = [
  '架构合理性',
  '投入产出分析',
  '交付风险',
  '数据安全与合规',
  '用户体验',
];

/** Valid provider source values (matches buildProviderSummary five-state). */
const VALID_PROVIDER_SOURCES = [
  'mock',
  'lmstudio',
  'openai_compatible',
  'fallback_mock',
  'failed',
];

/** MODEL_PILOT_MAX_ROLES hard cap for external providers in batch mode. */
const MAX_BATCH_ROLES = 3;

/** Maximum batch count to prevent abuse. */
const MAX_BATCH_COUNT = 10;

// ── Types ──

export interface EvaluateOptions {
  provider?: string;
}

export interface BatchConfig {
  count: number;
  provider: string;
  template?: {
    title?: string;
    objective?: string;
    mode?: string;
  };
}

export interface ListQualityFilter {
  provider?: string;
  runMode?: string;
  page?: number;
  limit?: number;
}

// ── Service ──

@Injectable()
export class QualityService {
  private readonly logger = new Logger(QualityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reviewsService: ReviewsService,
  ) {}

  // ── Public API ──

  /**
   * Evaluate a single review's quality metrics.
   *
   * By default, uses the review's existing DB opinions and derives the
   * providerSource from modelOutputRef. When `opts.provider` is specified,
   * a fresh adapter is created and run for each role to generate synthetic
   * opinions for comparison.
   */
  async evaluateReview(
    reviewId: string,
    user: any,
    opts?: EvaluateOptions,
  ) {
    const startTime = Date.now();

    // Tenant-isolated review fetch
    const review = await this.prisma.review.findFirst({
      where: { id: reviewId, tenantId: user.tenantId },
    });
    if (!review) throw new NotFoundException('Review not found');

    // Fetch existing DB opinions
    let opinions: any[] = await this.prisma.reviewOpinion.findMany({
      where: { reviewId },
      orderBy: { createdAt: 'asc' },
    });

    let providerSource: string;
    let modelName: string | null = null;
    let errorMessage: string | null = null;

    if (opts?.provider && opts.provider !== 'mock') {
      // External provider guard
      this.assertExternalAllowed(opts.provider);

      // Run adapter override to generate synthetic opinions
      const result = await this.runAdapterOverride(review, opts.provider, user.tenantId);
      if (result.opinions.length > 0) {
        opinions = result.opinions;
        providerSource = opts.provider;
        modelName = result.modelName;
      } else {
        providerSource = 'failed';
        errorMessage = result.error;
      }
    } else {
      // Use existing DB opinions
      if (opinions.length === 0) {
        providerSource = 'failed';
        errorMessage = 'No opinions found for this review';
      } else {
        providerSource = this.deriveProviderSource(opinions);
        modelName = this.extractModelName(opinions);
      }
    }

    const metrics = this.computeMetrics(opinions, EXPECTED_DIMENSIONS);

    const report = await this.prisma.qualityReport.create({
      data: {
        reviewId,
        providerSource,
        runMode: 'single',
        avgConfidence: metrics.avgConfidence,
        minConfidence: metrics.minConfidence,
        maxConfidence: metrics.maxConfidence,
        opinionCount: metrics.opinionCount,
        dimensionsCovered: metrics.dimensionsCovered,
        riskDistribution: metrics.riskDistribution as any,
        consistencyScore: null, // single mode — no cross-run consistency
        missingDimensions: metrics.missingDimensions,
        durationMs: Date.now() - startTime,
        modelName,
        errorMessage,
      },
    });

    this.logger.log(
      `QualityReport created for review ${reviewId}: provider=${providerSource}, ` +
        `avgConf=${metrics.avgConfidence.toFixed(1)}, opinions=${metrics.opinionCount}`,
    );

    return report;
  }

  /**
   * Run a batch of N reviews through the full pipeline and evaluate each.
   *
   * Creates temporary reviews with `[QUALITY-BATCH]` title prefix, runs them
   * through create → diagnose → roleSelect → start → poll completion, then
   * evaluates each and computes a cross-run consistency score.
   *
   * External providers are capped at MODEL_PILOT_MAX_ROLES (≤3) roles per review.
   */
  async evaluateBatch(config: BatchConfig, user: any) {
    const { count, provider, template } = config;

    // Validate count
    if (!count || count < 1 || count > MAX_BATCH_COUNT) {
      throw new BadRequestException(
        `count must be between 1 and ${MAX_BATCH_COUNT}`,
      );
    }

    // Validate provider
    if (!VALID_PROVIDER_SOURCES.includes(provider)) {
      throw new BadRequestException(`Invalid provider: ${provider}`);
    }

    // External provider guard
    const isExternal = provider === 'lmstudio' || provider === 'openai_compatible';
    if (isExternal) {
      this.assertExternalAllowed(provider);
    }

    // MODEL_PILOT_MAX_ROLES hard cap for external providers
    const maxRoles = isExternal
      ? Math.min(MAX_BATCH_ROLES, this.resolvePilotCap())
      : 5;

    const objective = template?.objective || '质量评测批量测试方案 — 测试模型输出质量指标';
    const titlePrefix = template?.title || `[QUALITY-BATCH]`;
    const mode = template?.mode || 'round_robin';

    const reports: any[] = [];

    for (let i = 0; i < count; i++) {
      const runTitle = `${titlePrefix} ${new Date().toISOString().slice(0, 19)} #${i + 1}`;
      try {
        const report = await this.runSingleBatchIteration(
          user,
          runTitle,
          objective,
          mode,
          provider,
          maxRoles,
        );
        reports.push(report);
      } catch (err: any) {
        this.logger.error(
          `Batch iteration ${i + 1}/${count} failed: ${err.message}`,
          err.stack,
        );
      }
    }

    if (reports.length === 0) {
      throw new BadRequestException(
        'All batch iterations failed — no QualityReports generated',
      );
    }

    // Compute cross-run consistency score and update all reports
    if (reports.length > 1) {
      const consistencyScore = this.computeConsistency(reports);
      await this.prisma.qualityReport.updateMany({
        where: { id: { in: reports.map(r => r.id) } },
        data: { consistencyScore },
      });
      reports.forEach(r => (r.consistencyScore = consistencyScore));

      this.logger.log(
        `Batch consistency score: ${consistencyScore.toFixed(4)} ` +
          `across ${reports.length} runs`,
      );
    }

    return reports;
  }

  /**
   * List quality reports with optional filtering and pagination.
   */
  async listQualityReports(filter: ListQualityFilter) {
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const limit = filter.limit && filter.limit > 0 ? filter.limit : 20;
    const offset = (page - 1) * limit;

    const where: any = {};
    if (filter.provider) where.providerSource = filter.provider;
    if (filter.runMode) where.runMode = filter.runMode;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.qualityReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.qualityReport.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  /**
   * Get a single quality report by ID.
   */
  async getQualityReport(id: string) {
    const report = await this.prisma.qualityReport.findUnique({
      where: { id },
    });
    if (!report) throw new NotFoundException('Quality report not found');
    return report;
  }

  // ── Private: batch iteration ──

  /**
   * Run a single batch iteration: create review → diagnose → select roles →
   * start → poll for completion → evaluate.
   */
  private async runSingleBatchIteration(
    user: any,
    title: string,
    objective: string,
    mode: string,
    provider: string,
    maxRoles: number,
  ) {
    const startTime = Date.now();

    // 1. Create review
    const review = await this.reviewsService.createReview(
      { title, objective, mode } as any,
      user,
    );

    try {
      // 2. Diagnose (builds mock diagnosis with 5 preset roles)
      await this.reviewsService.diagnose(review.id, user);

      // 3. Get diagnosis and select roles (capped at maxRoles)
      const diagnosis = await this.reviewsService.getDiagnosis(review.id, user);
      const rolesToSelect = (diagnosis?.recommendedRoles || [])
        .slice(0, maxRoles)
        .map(r => ({ roleId: r.roleId, weight: r.weight }));

      if (rolesToSelect.length === 0) {
        throw new Error('No roles available for selection');
      }

      await this.reviewsService.saveRoleSelection(review.id, user, {
        roles: rolesToSelect,
      });

      // 4. Start review (dispatches turns via orchestrator)
      await this.reviewsService.startReview(review.id, user);

      // 5. Poll for completion
      // Mock: ~5-15s; real provider: up to 300s
      const timeoutMs = provider === 'mock' ? 120_000 : 300_000;
      const completed = await this.pollReviewCompletion(review.id, timeoutMs);

      // 6. Fetch opinions
      const opinions = await this.prisma.reviewOpinion.findMany({
        where: { reviewId: review.id },
        orderBy: { createdAt: 'asc' },
      });

      let providerSource: string;
      let modelName: string | null = null;
      let errorMessage: string | null = null;

      if (opinions.length === 0) {
        providerSource = 'failed';
        errorMessage = completed
          ? 'Review completed but no opinions generated'
          : 'Review timed out before completion';
      } else {
        providerSource = this.deriveProviderSource(opinions);
        modelName = this.extractModelName(opinions);
      }

      const metrics = this.computeMetrics(opinions, EXPECTED_DIMENSIONS);

      const report = await this.prisma.qualityReport.create({
        data: {
          reviewId: review.id,
          providerSource,
          runMode: 'batch',
          avgConfidence: metrics.avgConfidence,
          minConfidence: metrics.minConfidence,
          maxConfidence: metrics.maxConfidence,
          opinionCount: metrics.opinionCount,
          dimensionsCovered: metrics.dimensionsCovered,
          riskDistribution: metrics.riskDistribution as any,
          consistencyScore: null, // filled after all iterations complete
          missingDimensions: metrics.missingDimensions,
          durationMs: Date.now() - startTime,
          modelName,
          errorMessage,
        },
      });

      this.logger.log(
        `Batch report: review=${review.id}, provider=${providerSource}, ` +
          `avgConf=${metrics.avgConfidence.toFixed(1)}, opinions=${metrics.opinionCount}`,
      );

      return report;
    } catch (err: any) {
      // Record failure as a QualityReport if we have a reviewId
      this.logger.error(`Batch iteration failed for review ${review.id}: ${err.message}`);

      const report = await this.prisma.qualityReport.create({
        data: {
          reviewId: review.id,
          providerSource: 'failed',
          runMode: 'batch',
          avgConfidence: 0,
          minConfidence: 0,
          maxConfidence: 0,
          opinionCount: 0,
          dimensionsCovered: [],
          riskDistribution: { high: 0, medium: 0, low: 0, info: 0 },
          consistencyScore: null,
          missingDimensions: EXPECTED_DIMENSIONS,
          durationMs: Date.now() - startTime,
          modelName: null,
          errorMessage: err.message,
        },
      });
      return report;
    }
  }

  // ── Private: polling ──

  /**
   * Poll review status until it reaches a terminal state (completed/failed)
   * or the timeout expires. Returns true if the review reached a terminal state.
   */
  private async pollReviewCompletion(
    reviewId: string,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    const pollInterval = 500; // ms

    while (Date.now() < deadline) {
      const review = await this.prisma.review.findUnique({
        where: { id: reviewId },
        select: { status: true },
      });
      if (!review) return false;
      if (review.status === 'completed' || review.status === 'failed') {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    return false;
  }

  // ── Private: provider override ──

  /**
   * Run a fresh adapter (with the specified provider) for each role in the
   * review's roleSelection. Returns synthetic opinions (not persisted to DB).
   */
  private async runAdapterOverride(
    review: any,
    provider: string,
    tenantId: string,
  ): Promise<{
    opinions: any[];
    modelName: string | null;
    error: string | null;
  }> {
    const adapterEnv: ProviderEnv = {
      ...process.env,
      MODEL_PROVIDER: provider,
      ALLOW_EXTERNAL_MODEL_CALLS: 'true',
    };
    const adapter = createProviderAdapter(adapterEnv);

    // If the factory fell back to mock (guard), report it
    if (adapter.name === 'mock' && provider !== 'mock') {
      return {
        opinions: [],
        modelName: null,
        error: `Provider "${provider}" was guarded to mock (check ALLOW_EXTERNAL_MODEL_CALLS)`,
      };
    }

    // Get role selection
    const roleSelection = review.roleSelection as any;
    if (!roleSelection?.roles) {
      return { opinions: [], modelName: null, error: 'No role selection found' };
    }

    // Get role details
    const roleIds = roleSelection.roles.map((r: any) => r.roleId);
    const roles = await this.prisma.agentRole.findMany({
      where: { id: { in: roleIds }, tenantId },
      select: { id: true, code: true, name: true },
    });

    const opinions: any[] = [];
    let modelName: string | null = null;
    const errors: string[] = [];

    for (const role of roles) {
      const prompt = `You are reviewing as ${role.code}.\n\nProposal: ${review.objective}`;
      try {
        const output = await adapter.complete({
          prompt,
          system: SYSTEM_PROMPT,
          temperature: 0.1,
        });
        const parsed = parseModelOpinion(output.text);
        if (parsed) {
          opinions.push({
            dimension: parsed.dimension || 'unknown',
            riskLevel: parsed.riskLevel || 'info',
            confidenceScore:
              typeof parsed.confidenceScore === 'number'
                ? parsed.confidenceScore
                : 50,
            modelOutputRef: JSON.stringify({
              providerSource: adapter.name,
              modelName: output.model,
              fallback: false,
            }),
          });
          if (output.model) modelName = output.model;
        } else {
          errors.push(`${role.code}: unparseable output`);
        }
      } catch (err: any) {
        errors.push(`${role.code}: ${err.message}`);
      }
    }

    return {
      opinions,
      modelName,
      error: opinions.length > 0 ? null : `All adapter calls failed: ${errors.join('; ')}`,
    };
  }

  // ── Private: metric computation ──

  /**
   * Compute all quality metrics from an array of opinion objects.
   * Each opinion must have: confidenceScore (number), dimension (string),
   * riskLevel (string).
   */
  private computeMetrics(opinions: any[], expectedDimensions: string[]) {
    if (opinions.length === 0) {
      return {
        avgConfidence: 0,
        minConfidence: 0,
        maxConfidence: 0,
        opinionCount: 0,
        dimensionsCovered: [] as string[],
        riskDistribution: { high: 0, medium: 0, low: 0, info: 0 },
        missingDimensions: expectedDimensions,
      };
    }

    const confidences: number[] = opinions.map(o =>
      typeof o.confidenceScore === 'number' ? o.confidenceScore : 0,
    );
    const dimensions: string[] = [
      ...new Set(opinions.map(o => o.dimension || 'unknown')),
    ];

    return {
      avgConfidence: confidences.reduce((a, b) => a + b, 0) / confidences.length,
      minConfidence: Math.min(...confidences),
      maxConfidence: Math.max(...confidences),
      opinionCount: opinions.length,
      dimensionsCovered: dimensions,
      riskDistribution: this.computeRiskDistribution(opinions),
      missingDimensions: expectedDimensions.filter(d => !dimensions.includes(d)),
    };
  }

  /**
   * Count opinions by risk level → { high, medium, low, info }.
   */
  private computeRiskDistribution(opinions: any[]): {
    high: number;
    medium: number;
    low: number;
    info: number;
  } {
    const dist = { high: 0, medium: 0, low: 0, info: 0 };
    for (const o of opinions) {
      const level = (o.riskLevel || 'info').toLowerCase();
      if (level in dist) {
        dist[level as keyof typeof dist]++;
      } else {
        dist.info++; // unknown levels → info
      }
    }
    return dist;
  }

  /**
   * Compute cross-run consistency from multiple QualityReports.
   *
   * Uses the coefficient of variation (CV) of avgConfidence:
   *   consistency = max(0, 1 - CV)  where CV = stddev / mean
   *
   * A score of 1.0 means all runs had identical avgConfidence.
   * A score near 0 means high variance across runs.
   */
  private computeConsistency(reports: any[]): number {
    if (reports.length < 2) return 1.0;

    const avgConfidences: number[] = reports.map(r =>
      typeof r.avgConfidence === 'number' ? r.avgConfidence : 0,
    );
    const mean =
      avgConfidences.reduce((a, b) => a + b, 0) / avgConfidences.length;

    if (mean === 0) return 0;

    const variance =
      avgConfidences.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      avgConfidences.length;
    const stddev = Math.sqrt(variance);
    const cv = stddev / mean;

    return Math.max(0, Math.min(1, 1 - cv));
  }

  // ── Private: provider source derivation ──

  /**
   * Derive the dominant providerSource from opinions' modelOutputRef.
   * modelOutputRef is a JSON string: { providerSource, modelName, fallback }.
   */
  private deriveProviderSource(opinions: any[]): string {
    const counts: Record<string, number> = {};
    for (const o of opinions) {
      let ref: any = null;
      try {
        if (o.modelOutputRef) ref = JSON.parse(o.modelOutputRef);
      } catch {
        /* ignore parse errors */
      }
      const source = ref?.providerSource || 'mock';
      counts[source] = (counts[source] || 0) + 1;
    }

    // Return the most common source
    let maxCount = 0;
    let dominantSource = 'mock';
    for (const [source, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        dominantSource = source;
      }
    }
    return dominantSource;
  }

  /**
   * Extract the model name from the first opinion with a modelOutputRef.
   */
  private extractModelName(opinions: any[]): string | null {
    for (const o of opinions) {
      try {
        if (o.modelOutputRef) {
          const ref = JSON.parse(o.modelOutputRef);
          if (ref?.modelName) return ref.modelName;
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  // ── Private: guards ──

  /**
   * Assert that external model calls are allowed for the given provider.
   */
  private assertExternalAllowed(provider: string): void {
    if (process.env.ALLOW_EXTERNAL_MODEL_CALLS !== 'true') {
      throw new BadRequestException(
        `External provider "${provider}" requires ALLOW_EXTERNAL_MODEL_CALLS=true in the environment.`,
      );
    }
  }

  /**
   * Resolve MODEL_PILOT_MAX_ROLES from env (default 3, max 3).
   */
  private resolvePilotCap(): number {
    const raw = process.env.MODEL_PILOT_MAX_ROLES;
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.min(parsed, MAX_BATCH_ROLES);
      }
    }
    return MAX_BATCH_ROLES;
  }
}
