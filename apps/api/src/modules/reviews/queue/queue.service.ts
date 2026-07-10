import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

interface QueueJob {
  id: string;
  type: 'review.start' | 'agent.turn.execute' | 'meeting.complete';
  payload: any;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  retries: number;
}

/**
 * In-memory mock queue for Sprint 4.2.
 * Processes jobs sequentially with setTimeout-based scheduling.
 * No Redis/BullMQ dependency required.
 * NOT production — replaces Sprint 4.3+ with BullMQ.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private queue: QueueJob[] = [];
  private processing = false;
  private timer: NodeJS.Timeout | null = null;
  private processedIds = new Set<string>();  // Idempotency tracking

  private readonly MAX_RETRIES = 3;
  private readonly POLL_INTERVAL = 100; // ms

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enqueue a job. If a job with the same idempotency ID already exists, skip.
   */
  enqueue(type: QueueJob['type'], payload: any, id?: string): string {
    const jobId = id || `${type}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

    // Idempotency check
    if (this.processedIds.has(jobId)) {
      this.logger.log(`Idempotent skip: ${jobId} already processed`);
      return jobId;
    }

    // Check if already queued
    if (this.queue.some(j => j.id === jobId && j.status === 'queued')) {
      return jobId;
    }

    this.queue.push({ id: jobId, type, payload, status: 'queued', retries: 0 });
    this.logger.log(`Enqueued: ${type} (${jobId.substring(0, 30)}...)`);
    this.scheduleProcessing();
    return jobId;
  }

  private scheduleProcessing(): void {
    if (this.processing) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.processNext(), this.POLL_INTERVAL);
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;
    const job = this.queue.find(j => j.status === 'queued');
    if (!job) { this.processing = false; return; }

    this.processing = true;
    job.status = 'processing';

    try {
      await this.executeJob(job);
      job.status = 'completed';
      this.processedIds.add(job.id);
      this.logger.log(`Completed: ${job.type} (${job.id.substring(0, 30)}...)`);
    } catch (err) {
      const msg = err.message || '';
      // NO_RETRY errors (guard/auth) — fail immediately, no retry
      if (msg.startsWith('NO_RETRY:')) {
        job.status = 'failed';
        this.processedIds.add(job.id);
        this.logger.error(`Failed (no retry): ${job.type} — ${msg.replace('NO_RETRY:', '')}`);
      } else {
        job.retries++;
        if (job.retries <= this.MAX_RETRIES) {
          job.status = 'queued';
          this.logger.warn(`Retry ${job.retries}/${this.MAX_RETRIES}: ${job.type} — ${msg}`);
        } else {
          job.status = 'failed';
          this.processedIds.add(job.id);
          this.logger.error(`Failed after ${this.MAX_RETRIES} retries: ${job.type} — ${msg}`);
        }
      }
    }

    this.processing = false;
    // Schedule next
    this.timer = setTimeout(() => this.processNext(), this.POLL_INTERVAL);
  }

  private async executeJob(job: QueueJob): Promise<void> {
    switch (job.type) {
      case 'review.start':
        return this.executeReviewStart(job.payload);
      case 'agent.turn.execute':
        return this.executeAgentTurn(job.payload);
      case 'meeting.complete':
        return this.executeMeetingComplete(job.payload);
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  // ── review.start ──

  private async executeReviewStart(payload: any): Promise<void> {
    const { reviewId } = payload;
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new Error(`Review not found: ${reviewId}`);
    if (review.status !== 'running') throw new Error(`Review status is "${review.status}", expected "running"`);

    const selection = review.roleSelection as any;
    if (!selection?.roles?.length) throw new Error('No role selection found');

    // ── Dev Pilot hard cap (Sprint 7.2 §3 / §10, implemented in Sprint 7.3) ──
    // MODEL_PILOT_MAX_ROLES is enforced ONLY when the dev pilot provider
    // (lmstudio + ALLOW_EXTERNAL_MODEL_CALLS=true) is active. Default / mock
    // reviews are returned unchanged, so the default mock demo stays intact.
    const allRoles = (selection.roles as any[]);
    const effectiveRoles = this.applyPilotRoleCap(allRoles);
    if (effectiveRoles.length !== allRoles.length) {
      this.logger.warn(
        `[Pilot] Capping pilot review roles ${allRoles.length} → ${effectiveRoles.length} (MODEL_PILOT_MAX_ROLES)`,
      );
      // Persist the trimmed selection so downstream turn/meeting counts stay consistent.
      await this.prisma.review.update({
        where: { id: reviewId },
        data: { roleSelection: { ...selection, roles: effectiveRoles } as any },
      });
    }

    // Resolve roleVersionIds
    const roleIds = effectiveRoles.map((r: any) => r.roleId);
    const dbRoles: any[] = await this.prisma.agentRole.findMany({
      where: { id: { in: roleIds }, status: 'enabled' },
      select: { id: true, code: true, activeVersionId: true },
    });
    const roleMap = new Map(dbRoles.map(r => [r.id, r]));

    for (const [i, role] of effectiveRoles.entries()) {
      const dbRole: any = roleMap.get(role.roleId);
      if (!dbRole) throw new Error(`Role ${role.roleId} not found or disabled`);
      if (!dbRole.activeVersionId) throw new Error(`Role "${dbRole.code}" has no activeVersionId`);

      const turnIndex = i + 1;
      const jobId = `agent.turn.execute.${reviewId}.${turnIndex}`;

      this.enqueue('agent.turn.execute', {
        reviewId,
        turnIndex,
        roleId: role.roleId,
        roleCode: dbRole.code,
        roleVersionId: dbRole.activeVersionId,
        objective: review.objective,
      }, jobId);
    }
  }

  /**
   * Dev-pilot role cap (Sprint 7.2 §3 / §10, implemented in Sprint 7.3).
   *
   * Returns the (possibly trimmed) role list for this review. Trimming only
   * happens when the dev-only pilot provider is active — i.e.
   * MODEL_PROVIDER=lmstudio AND ALLOW_EXTERNAL_MODEL_CALLS=true. For every
   * other mode (default / mock / unset) the full role list is returned
   * unchanged, preserving the default mock demo behavior exactly.
   *
   * Cap resolution (per contract "不设时不限制或默认 3"):
   *   env unset / empty      → 3
   *   env = positive integer → that integer
   *   env invalid            → 3
   */
  private applyPilotRoleCap(roles: any[]): any[] {
    const provider = (process.env.MODEL_PROVIDER || '').toLowerCase();
    const allow = process.env.ALLOW_EXTERNAL_MODEL_CALLS || '';
    if (provider !== 'lmstudio' || allow !== 'true') return roles;

    const raw = process.env.MODEL_PILOT_MAX_ROLES;
    let max: number;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      max = 3; // contract default when unset
    } else {
      const parsed = parseInt(String(raw), 10);
      max = Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
    }
    if (!Number.isFinite(max) || max <= 0) max = 3;

    return roles.slice(0, max);
  }

  // ── agent.turn.execute ──

  private async executeAgentTurn(payload: any): Promise<void> {
    const { reviewId, turnIndex, roleId, roleCode, roleVersionId, objective } = payload;

    // DB idempotency: check if this turn already completed
    const existing = await this.prisma.reviewTurn.findFirst({
      where: { reviewId, turnIndex, status: { in: ['completed', 'failed', 'timeout'] } },
    });
    if (existing) {
      this.logger.log(`Idempotent skip: turn ${turnIndex} for review ${reviewId.substring(0, 8)} already terminal`);
      return;
    }

    // Create ReviewTurn
    const reviewTurn = await this.prisma.reviewTurn.create({
      data: {
        reviewId,
        turnIndex,
        phase: 'round_robin',
        roleVersionId,
        status: 'queued',
        startedAt: new Date(),
      },
    });

    await this.prisma.reviewTurn.update({
      where: { id: reviewTurn.id },
      data: { status: 'thinking' },
    });

    // Execute provider via provider-adapter
    const adapterPath = require('path').resolve(__dirname, '../../../../../../scripts/provider-adapter');
    const { getProvider } = require(adapterPath);
    
    let provider: any;
    try {
      provider = getProvider();
    } catch (err: any) {
      // Guard error — fail closed, no retry, no fallback
      this.logger.error(`Provider config error (no retry): ${err.message}`);
      await this.prisma.reviewTurn.update({
        where: { id: reviewTurn.id },
        data: { status: 'failed', completedAt: new Date() },
      });
      // Create a failed opinion stub for observability
      await this.prisma.reviewOpinion.create({
        data: {
          reviewId, turnId: reviewTurn.id,
          dimension: '', riskLevel: 'info', issue: '', recommendation: '',
          citations: [], confidenceScore: 0,
          reasoningSummary: 'Guard error: ' + err.message.substring(0, 180),
          modelOutputRef: JSON.stringify({ providerSource: 'failed', providerName: process.env.MODEL_PROVIDER || 'unknown', fallback: false, errorReason: err.message.substring(0, 200) }),
        },
      });
      throw new Error('NO_RETRY:' + err.message);
    }

    let result: any;
    let observability: any;
    const startTime = Date.now();

    try {
      result = await provider.run(roleCode, objective);
      const durationMs = Date.now() - startTime;
      // Success — use provider's own metadata
      observability = {
        providerSource: result.provider || provider.name,
        providerName: provider.name,
        modelName: result.model || 'unknown',
        fallback: false,
        durationMs,
        tokens: undefined as any,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      // Auth errors (401/403) — fail closed, no fallback
      if (err.message.includes('HTTP 401') || err.message.includes('HTTP 403')) {
        const sanitizedMsg = err.message.replace(/Bearer [a-zA-Z0-9._-]+/g, 'Bearer ***');
        this.logger.error(`Auth error (no fallback): ${sanitizedMsg}`);
        await this.prisma.reviewTurn.update({
          where: { id: reviewTurn.id },
          data: { status: 'failed', completedAt: new Date() },
        });
        await this.prisma.reviewOpinion.create({
          data: {
            reviewId, turnId: reviewTurn.id,
            dimension: '', riskLevel: 'info', issue: '', recommendation: '',
            citations: [], confidenceScore: 0,
            reasoningSummary: 'Auth error (no fallback): ' + sanitizedMsg.substring(0, 160),
            modelOutputRef: JSON.stringify({ providerSource: 'failed', providerName: provider.name, modelName: provider.model || 'unknown', fallback: false, errorReason: sanitizedMsg.substring(0, 200), durationMs }),
          },
        });
        throw new Error('NO_RETRY:' + err.message);
      }
      // Runtime error — fallback to mock with warn
      this.logger.warn(`[Fallback] ${provider.name} → mock, reason: ${err.message}`);
      const fallbackProvider = require(adapterPath).mockProvider;
      result = fallbackProvider(roleCode);
      observability = {
        providerSource: 'fallback_mock',
        providerName: provider.name,
        modelName: process.env.MODEL_NAME || 'unknown',
        fallback: true,
        fallbackReason: err.message.substring(0, 200),
        errorReason: err.message.substring(0, 200),
        durationMs,
      };
    }

    // Write opinion with observability
    const opinion = await this.prisma.reviewOpinion.create({
      data: {
        reviewId, turnId: reviewTurn.id,
        dimension: result.dimension,
        riskLevel: result.riskLevel,
        issue: result.issue,
        recommendation: result.recommendation,
        citations: [],
        confidenceScore: result.confidenceScore,
        reasoningSummary: this.buildReasoningSummary(observability),
        modelOutputRef: JSON.stringify(observability),
      },
    });

    await this.prisma.reviewTurn.update({
      where: { id: reviewTurn.id },
      data: { status: 'completed', completedAt: new Date() },
    });

    this.logger.log(`Turn ${turnIndex}/${roleCode}: ${result.riskLevel} risk, ${result.confidenceScore} confidence`);
    await this.checkMeetingComplete(reviewId);
  }

  private buildReasoningSummary(obs: any): string {
    const parts = [`src=${obs.providerSource}`];
    if (obs.modelName) parts.push(obs.modelName);
    if (obs.fallbackReason) parts.push(`fallback: ${obs.fallbackReason.substring(0, 80)}`);
    if (obs.errorReason && !obs.fallbackReason) parts.push(`err: ${obs.errorReason.substring(0, 80)}`);
    return parts.join(' | ').substring(0, 200);
  }

  // ── meeting.complete coordination ──

  private async checkMeetingComplete(reviewId: string): Promise<void> {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) return;
    if (review.status !== 'running') return; // Already completed

    const selection = review.roleSelection as any;
    const expectedCount = selection?.roles?.length ?? 0;
    if (expectedCount === 0) return;

    const terminalCount = await this.prisma.reviewTurn.count({
      where: { reviewId, status: { in: ['completed', 'failed', 'timeout'] } },
    });

    if (terminalCount >= expectedCount) {
      this.logger.log(`All ${expectedCount} turns terminal → enqueuing meeting.complete`);
      const jobId = `meeting.complete.${reviewId}`;
      this.enqueue('meeting.complete', { reviewId, expectedCount, terminalCount }, jobId);
    }
  }

  // ── meeting.complete ──

  private async executeMeetingComplete(payload: any): Promise<void> {
    const { reviewId } = payload;

    // DB idempotency: re-check review status
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new Error(`Review not found: ${reviewId}`);
    if (review.status !== 'running') {
      this.logger.log(`Idempotent skip: review ${reviewId.substring(0, 8)} already ${review.status}`);
      return;
    }

    // Count from DB (not from payload)
    const selection = review.roleSelection as any;
    const expectedCount = selection?.roles?.length ?? 0;

    const completedCount = await this.prisma.reviewTurn.count({
      where: { reviewId, status: 'completed' },
    });
    const failedCount = await this.prisma.reviewTurn.count({
      where: { reviewId, status: { in: ['failed', 'timeout'] } },
    });
    const terminalCount = completedCount + failedCount;

    if (terminalCount < expectedCount) {
      this.logger.log(`Idempotent skip: ${terminalCount}/${expectedCount} terminal, not ready yet`);
      return;
    }

    // Determine final status
    let finalStatus: string;
    if (completedCount === expectedCount) {
      finalStatus = 'completed';
    } else if (completedCount > 0) {
      finalStatus = 'completed'; // partial success
    } else {
      finalStatus = 'failed';
    }

    await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: finalStatus },
    });

    this.logger.log(`Review ${reviewId.substring(0, 8)} → ${finalStatus} (${completedCount}/${expectedCount} completed, ${failedCount} failed)`);
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
  }
}
