import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { findExistingTerminalTurn } from '../orchestrator/idempotency';
import { shouldDispatchTurn, resolveHardGates } from '../orchestrator/hard-gates';
import { validateOpinion, StructuredOpinion, RiskLevel } from '../orchestrator/opinion';
import { ModelAdapter, MockAdapter, buildSystemPrompt, isLikelyChinese, parseModelOpinion } from '../provider/model-adapter';
import { createProviderAdapter } from '../provider/provider-factory';
import { PromptServiceImpl } from '../../prompt/prompt.service';
import { MemoryServiceImpl, type MemoryService } from '../../memory/memory.service';

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

  // Sprint 2.1: unified model adapter. Default: global (mock via factory,
  // external only when ALLOW_EXTERNAL_MODEL_CALLS=true + explicit env).
  // Per-review override: 当 review 行带了 providerOverride + providerConfig 时，
  // 按 review 配置构造独立 adapter（DB 里的 Config 优先，env 兜底）。
  // Never logs nor leaks providerConfig.apiKey.
  private readonly defaultAdapter: ModelAdapter = createProviderAdapter();

  /**
   * 返回本次 turn 应使用的 ModelAdapter：
   *   1. 若 job payload 没带 providerOverride → 用全局 defaultAdapter
   *   2. 带了 → 构造独立 adapter（env 兜底 + config 覆盖，不污染全局）
   * apiKey 在任何 log / observability / providerSource 中都不出现。
   */
  private async resolveAdapter(payload: any): Promise<ModelAdapter> {
    const override: string | undefined = payload?.providerOverride;
    const cfg: any = payload?.providerConfig;
    if (!override) return this.defaultAdapter;
    // 合并 env 兜底 + DB config 覆盖；apiKey 仅此处拼入，绝不落日志
    const env: any = {
      MODEL_PROVIDER: override,
      ALLOW_EXTERNAL_MODEL_CALLS: 'true',
    };
    if (cfg?.model) env.MODEL_NAME = cfg.model;
    if (cfg?.baseUrl) env.MODEL_BASE_URL = cfg.baseUrl;
    if (override === 'lmstudio' || override === 'openai_compatible') {
      if (cfg?.apiKey) env.MODEL_API_KEY = cfg.apiKey;
      else if (process.env.MODEL_API_KEY) env.MODEL_API_KEY = process.env.MODEL_API_KEY;
    }
    return createProviderAdapter(env);
  }

  /**
   * 完成回调钩子（由 ReviewOrchestrator 在 onModuleInit 注入）。
   * 当全部 turn 终态、meeting.complete 触发时，委派 orchestrator 走
   * summarized(Moderator converge) → completed 脊柱。未注入时走 legacy 直接定终态。
   */
  completionHook?: (reviewId: string) => Promise<void>;

  private readonly MAX_RETRIES = 3;
  private readonly POLL_INTERVAL = 100; // ms

  constructor(
    private readonly prisma: PrismaService,
    // P3 注入位（NodeCtx 等价）：真实服务由模块装配注入；手动 `new QueueService(prisma)` 时为 undefined → 降级 SYSTEM_PROMPT。
    private readonly promptService?: PromptServiceImpl,
    private readonly memoryService?: MemoryServiceImpl,
  ) {}

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

    // P2-1：round 贯通。优先用派发链下传的 round（orchestrator nodeRunning 显式传入）；
    // 缺失时回退到 review.currentRound（语义正确，非静默 1）。
    const round: number = payload.round ?? (review as any).currentRound ?? 1;

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

    // 硬闸默认值来自 MODEL_PILOT_MAX_ROLES（默认 3），与 §5.2 对齐
    const gates = resolveHardGates();

    for (const [i, role] of effectiveRoles.entries()) {
      const dbRole: any = roleMap.get(role.roleId);
      if (!dbRole) throw new Error(`Role ${role.roleId} not found or disabled`);
      if (!dbRole.activeVersionId) throw new Error(`Role "${dbRole.code}" has no activeVersionId`);

      // 每评审员硬闸（泛化 MODEL_PILOT_MAX_ROLES）：同一 reviewer 已达上限则不派发。
      // round-1 各评审员各发言一次 → 不触发；仅当同一 reviewer 被派发 > N 次时拦截。
      const canDispatch = await shouldDispatchTurn(this.prisma, {
        reviewId, roleVersionId: dbRole.activeVersionId, maxTurns: gates.maxTurnsPerReviewer,
      });
      if (!canDispatch) {
        this.logger.warn(`Hard gate: reviewer ${dbRole.activeVersionId} reached max_turns_per_reviewer=${gates.maxTurnsPerReviewer}, skip dispatch`);
        continue;
      }

      const turnIndex = i + 1;
      // 9.5b 多轮：job id 带 round，避免 round-1 已处理后 processedIds 命中导致 round-2 不派发
      const jobId = `agent.turn.execute.${reviewId}.r${round}.${turnIndex}`;

      // P5 (Sprint 5.3 §6.3)：phase 由 workflow.turnPhasePattern[round-1] 决定；
      // 缺省（无 pattern / 越界）回退到既有启发式（round>=2 → debate）。
      const phasePattern: string[] | undefined = Array.isArray((payload as any).turnPhasePattern)
        ? (payload as any).turnPhasePattern
        : undefined;
      const phaseFromPattern = phasePattern && phasePattern[round - 1]
        ? phasePattern[round - 1]
        : (round >= 2 ? 'debate' : 'round_robin');

      this.enqueue('agent.turn.execute', {
        reviewId,
        turnIndex,
        roleId: role.roleId,
        roleCode: dbRole.code,
        roleVersionId: dbRole.activeVersionId,
        objective: review.objective,
        round, // P2-1：贯通到 turn 执行，供 reviewTurn.round 写入 + 语义元组幂等
        // 9.5b：round>=2 的辩论轮标记为 debate phase（mock debater，Contract §10）；P5 由 workflow pattern 覆盖
        phase: phaseFromPattern === 'debate' ? 'debate' : 'round_robin',
        // 产品化：每 review 可覆盖 provider / model / apiKey（DB 优先，env 兜底）
        providerOverride: review.providerOverride || undefined,
        providerConfig: review.providerConfig || undefined,
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

    // P2-1：round 必须显式贯通，不得静默回退 1。9.4 单轮恒为 1 掩盖了此缺口；
    // 9.5 round-2 若链断路会全部错发 round=1 且导致语义元组幂等键冲突。
    // 缺失/非法 → 拒绝该 turn（NO_RETRY），由上游修正派发链。
    const round = payload.round;
    if (typeof round !== 'number' || !Number.isInteger(round) || round < 1) {
      this.logger.error(
        `agent.turn.execute: missing/invalid round for review ${reviewId.substring(0, 8)} reviewer ${roleVersionId} (payload.round=${round}) → refuse (NO_RETRY)`,
      );
      throw new Error('NO_RETRY: agent.turn.execute payload.round missing or invalid');
    }

    // DB idempotency（Codex 指令 1）：按语义元组 (reviewId, roleVersionId, round) 查询，
    // 天然覆盖 3 段键 `${reviewId}::${roleVersionId}::${round}` 与 4 段键
    // `${reviewId}::${roleVersionId}::${round}::${N}`（9.3 消歧后缀）—— 不依赖 idempotencyKey 字符串相等。
    const existing = await findExistingTerminalTurn(this.prisma, {
      reviewId, roleVersionId, round,
    });
    if (existing.found) {
      this.logger.log(`Idempotent skip: turn for reviewer ${roleVersionId} round ${round} already terminal`);
      return;
    }

    // Create ReviewTurn — round 取派发链下传值（P2-1），idempotencyKey 与 round 一致。
    // phase 来自派发链（round>=2 为 debate，Contract §10 mock debater）。
    const turnPhase = payload.phase === 'debate' ? 'debate' : 'round_robin';
    const reviewTurn = await this.prisma.reviewTurn.create({
      data: {
        reviewId,
        turnIndex,
        phase: turnPhase,
        roleVersionId,
        status: 'queued',
        startedAt: new Date(),
        round,
        idempotencyKey: `${reviewId}::${roleVersionId}::${round}`,
      },
    });

    await this.prisma.reviewTurn.update({
      where: { id: reviewTurn.id },
      data: { status: 'thinking' },
    });

    // Execute provider via unified ModelAdapter abstraction (Sprint 2.1).
    // Per-review override: 若 review 行带了 providerOverride，按 review 配置构造独立 adapter。
    const adapter: ModelAdapter = await this.resolveAdapter(payload);

    // P3：PromptService 四层组装（mock 确定性，不调真实 LLM）。失败则降级 SYSTEM_PROMPT。
    // Language-adaptif : construire un system prompt dans la langue du contenu
    let system: string = buildSystemPrompt(objective || '');
    let promptRefs: any = null;
    if (this.promptService) {
      try {
        const composed = await this.promptService.compose({
          reviewId,
          roleCode,
          round,
          phase: turnPhase,
          memoryService: this.memoryService,
        });
        system = composed.system;
        promptRefs = composed.templateRefs;
      } catch (e: any) {
        this.logger.warn(`PromptService.compose degraded to SYSTEM_PROMPT: ${e?.message}`);
      }
    }

    // user prompt — language-aware. Le préfixe "You are reviewing as X." reste
    // en anglais (le mock adapter extrait le code rôle via regex), mais les
    // consignes passent en chinois si le contenu est chinois.
    const isZh = isLikelyChinese(objective || '');
    const prompt = [
      `You are reviewing as ${roleCode}.`,
      '',
      isZh ? '方案内容：' : 'Proposal:',
      objective,
      '',
      isZh
        ? '只用原始 JSON 回答（不要 markdown、不要推理过程、不要 ```json 围栏）。'
        : 'Respond with ONLY a raw JSON object (no markdown, no reasoning, no prose, no ``` fences).',
    ].join('\n');

    let result: any;
    let observability: any;
    const startTime = Date.now();

    try {
      const out = await adapter.complete({ prompt, system, temperature: 0.1, jsonMode: adapter.name !== 'mock' });
      const durationMs = Date.now() - startTime;
      const parsed = parseModelOpinion(out.text);
      if (!parsed || !parsed.riskLevel) {
        throw new Error(`Unparseable model output (first 400): ${out.text.substring(0, 300)}`);
      }
      result = parsed;
      observability = {
        providerSource: adapter.name,
        providerName: adapter.name,
        modelName: out.model || 'unknown',
        fallback: false,
        durationMs,
        tokens: out.usage ? out.usage.totalTokens : undefined,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const msg: string = err?.message || String(err);
      // Auth errors (401/403) — fail closed, no fallback (redact any leaked bearer)
      if (msg.includes('HTTP 401') || msg.includes('HTTP 403')) {
        const sanitizedMsg = msg.replace(/Bearer [a-zA-Z0-9._-]+/g, 'Bearer ***');
        this.logger.error(`Auth error (no fallback): ${sanitizedMsg}`);
        await this.failTurnAndOpinion(reviewId, reviewTurn.id, roleCode, adapter.name, 'Auth error (no fallback): ' + sanitizedMsg.substring(0, 160), durationMs);
        throw new Error('NO_RETRY:' + msg);
      }
      // Guard error (missing key / misconfig) — fail closed, no fallback
      if (msg.includes('GUARD') || msg.includes('MODEL PROVIDER GUARD')) {
        this.logger.error(`Provider guard error (no retry): ${msg}`);
        await this.failTurnAndOpinion(reviewId, reviewTurn.id, roleCode, adapter.name, 'Guard error: ' + msg.substring(0, 180), durationMs);
        throw new Error('NO_RETRY:' + msg);
      }
      // Runtime error — fallback to mock with warn (only when a real provider was used)
      if (adapter.name !== 'mock') {
        this.logger.warn(`[Fallback] ${adapter.name} → mock, reason: ${msg}`);
        const fallbackOut = await new MockAdapter().complete({ prompt, system });
        const parsed = parseModelOpinion(fallbackOut.text);
        result = parsed || {};
        observability = {
          providerSource: 'fallback_mock',
          providerName: adapter.name,
          modelName: 'mock',
          fallback: true,
          fallbackReason: msg.substring(0, 200),
          errorReason: msg.substring(0, 200),
          durationMs,
        };
      } else {
        // Mock itself failed (should not happen) — fail closed
        this.logger.error(`Mock adapter error (no retry): ${msg}`);
        await this.failTurnAndOpinion(reviewId, reviewTurn.id, roleCode, 'mock', 'Mock error: ' + msg.substring(0, 180), durationMs);
        throw new Error('NO_RETRY:' + msg);
      }
    }

    // §4.2 opinion schema 运行校验。失败 → turn failed + failed opinion 存根（不阻塞整场，其他 turn 仍可完成）。
    const opinionCandidate: StructuredOpinion = {
      schemaVersion: '1.0',
      reviewerId: roleVersionId,
      round, // P2-1：来自派发链下传的 round（已校验）
      dimension: result.dimension,
      riskLevel: result.riskLevel as RiskLevel,
      issue: result.issue,
      recommendation: result.recommendation,
      citations: [],
      confidenceScore: result.confidenceScore,
      modelOutputRef: JSON.stringify(observability),
    };
    const validation = validateOpinion(opinionCandidate);
    if (!validation.valid) {
      this.logger.warn(`Opinion validation failed (${roleCode}): ${validation.errors.join('; ')}`);
      await this.prisma.reviewTurn.update({
        where: { id: reviewTurn.id },
        data: { status: 'failed', completedAt: new Date() },
      });
      await this.prisma.reviewOpinion.create({
        data: {
          reviewId, turnId: reviewTurn.id,
          dimension: String(opinionCandidate.dimension || '').slice(0, 200),
          riskLevel: (opinionCandidate.riskLevel as string) || 'info',
          issue: 'opinion validation failed',
          recommendation: validation.errors.join('; ').slice(0, 500),
          citations: [], confidenceScore: 0,
          reasoningSummary: 'validateOpinion failed: ' + validation.errors.join('; ').slice(0, 180),
          modelOutputRef: JSON.stringify({ providerSource: 'failed', validationError: true }),
        },
      });
      throw new Error('NO_RETRY:opinion validation failed');
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
        // P3：prompt 版本溯源（ComposedPrompt.templateRefs 序列化）；未注入 promptService 时为 null
        promptRefs: (promptRefs ?? undefined) as any,
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

  /**
   * Shared fail-closed path for guard/auth errors: mark the turn failed and
   * write a failed-opinion stub for observability (modelOutputRef = failed
   * state). No retry, no fallback to mock.
   */
  private async failTurnAndOpinion(
    reviewId: string,
    turnId: string,
    roleCode: string,
    providerName: string,
    message: string,
    durationMs: number,
  ): Promise<void> {
    void roleCode;
    await this.prisma.reviewTurn.update({
      where: { id: turnId },
      data: { status: 'failed', completedAt: new Date() },
    });
    await this.prisma.reviewOpinion.create({
      data: {
        reviewId, turnId,
        dimension: '', riskLevel: 'info', issue: '', recommendation: '',
        citations: [], confidenceScore: 0,
        reasoningSummary: message.substring(0, 160),
        modelOutputRef: JSON.stringify({
          providerSource: 'failed',
          providerName,
          modelName: 'unknown',
          fallback: false,
          errorReason: message.substring(0, 200),
          durationMs,
        }),
      },
    });
  }

  // ── meeting.complete coordination ──

  /** 公开：供 Human Turn Override（P4 §3.4 T13）在插入人类意见后触发本轮完成判定。 */
  async checkMeetingComplete(reviewId: string): Promise<void> {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) return;
    if (review.status !== 'running') return; // Already completed

    const selection = review.roleSelection as any;
    const expectedCount = selection?.roles?.length ?? 0;
    if (expectedCount === 0) return;

    // 9.5b 多轮：按当前轮次 scope 完成判定。累计 terminal 数跨轮累加，须用 round 过滤，
    // 否则 round-2 第一个 turn 完成时（累计 terminal 已 ≥ expectedCount）会误触发 meeting.complete。
    const currentRound = (review as any).currentRound ?? 1;
    const terminalForRound = await this.prisma.reviewTurn.count({
      where: { reviewId, round: currentRound, status: { in: ['completed', 'failed', 'timeout'] } },
    });

    if (terminalForRound >= expectedCount) {
      this.logger.log(`All ${expectedCount} round-${currentRound} turns terminal → enqueuing meeting.complete (r${currentRound})`);
      // job id 带 round，避免 round-1 的 meeting.complete 已处理后 processedIds 命中导致 round-2 不触发
      const jobId = `meeting.complete.${reviewId}.r${currentRound}`;
      this.enqueue('meeting.complete', { reviewId, round: currentRound, expectedCount, terminalCount: terminalForRound }, jobId);
    }
  }

  // ── meeting.complete ──

  private async executeMeetingComplete(payload: any): Promise<void> {
    const { reviewId, round: payloadRound } = payload;

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

    // 9.5b 多轮：按当前轮次 scope 完成判定（与 checkMeetingComplete 一致），防跨轮累加误触发。
    const currentRound = payloadRound ?? (review as any).currentRound ?? 1;
    const completedForRound = await this.prisma.reviewTurn.count({
      where: { reviewId, round: currentRound, status: 'completed' },
    });
    const failedForRound = await this.prisma.reviewTurn.count({
      where: { reviewId, round: currentRound, status: { in: ['failed', 'timeout'] } },
    });
    const terminalForRound = completedForRound + failedForRound;

    if (terminalForRound < expectedCount) {
      this.logger.log(`Idempotent skip: round-${currentRound} ${terminalForRound}/${expectedCount} terminal, not ready yet`);
      return;
    }

    // → 编排脊柱（多轮 converge / continue_debate / force_stop）。若已接线则委派 orchestrator 完成决策与落库。
    if (this.completionHook) {
      this.logger.log(`All ${terminalForRound} round-${currentRound} turns terminal → delegating to orchestrator.handleTurnsComplete (review ${reviewId.substring(0, 8)})`);
      await this.completionHook(reviewId);
      return;
    }

    // 兜底 legacy（未接线时）：按终态比例定终态
    const finalStatus = completedForRound > 0 ? 'completed' : 'failed';
    await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: finalStatus },
    });
    this.logger.log(`Review ${reviewId.substring(0, 8)} → ${finalStatus} (legacy, ${completedForRound}/${expectedCount} completed, ${failedForRound} failed)`);
  }

  // ── 内存管理（P5 终态清理，防 Set/Map 泄漏）──

  /** 返回已处理 jobId 集合的副本（供 orchestrator.cleanupReview 扫描）。 */
  getProcessedIds(): Set<string> {
    return new Set(this.processedIds);
  }

  /** 删除特定的已处理 jobId（终态 review 清理）。 */
  deleteProcessedId(id: string): void {
    this.processedIds.delete(id);
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
  }
}
