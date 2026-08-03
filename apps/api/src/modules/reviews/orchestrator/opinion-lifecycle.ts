/**
 * opinion-lifecycle.ts — T1 (Sprint 11.0) 意见生命周期 + 内容键去重
 *
 * 设计来源：PR Review Agent Council FindingLifecycle（考古《phase1-design-patterns》模式 A/C）
 *  - candidate → challenged → accepted/rejected/downgraded，每次迁移带 reason；
 *  - 内容键去重：(dimension, normalizedIssue) → canonical，重复意见 rejected + 记录归并来源；
 *  - 报告只输出 accepted + downgraded（candidate 兜底可读，rejected 仅审计可查）。
 *
 * 分两层：
 *  1. OpinionLifecycle —— 纯函数/纯类（无 Prisma/IO），状态迁移规则 + 终结化决策，可单测；
 *  2. OpinionLifecycleService —— NestJS 服务：DB 读写 + 审计日志（AuditService，不阻塞主流程）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { OpinionStatus, computeDedupKey } from './opinion';

/** 报告可见状态：accepted / downgraded（+ candidate 兜底，避免 finalize 失败导致报告空白）；仅 rejected 排除。 */
export const REPORTABLE_STATUSES: ReadonlySet<string> = new Set<string>([
  'candidate',
  'accepted',
  'downgraded',
]);

export function isReportable(status: string | null | undefined): boolean {
  if (!status) return true; // 存量数据（无 status）视为可见
  return REPORTABLE_STATUSES.has(status);
}

/** 状态迁移表（来源：PR Council FindingLifecycle 泛化到通用评审）。 */
export const VALID_TRANSITIONS: Readonly<Record<OpinionStatus, readonly OpinionStatus[]>> = {
  candidate: ['challenged', 'accepted', 'rejected', 'downgraded'],
  challenged: ['candidate', 'accepted', 'rejected', 'downgraded'], // challenged→candidate = revise（回到候选，保留修订理由）
  accepted: ['downgraded'],
  rejected: [],
  downgraded: [],
};

/** 校验迁移是否合法；非法抛出 Error（供服务层 catch 后返回业务错误）。 */
export function assertTransition(from: OpinionStatus | null | undefined, to: OpinionStatus): void {
  const effectiveFrom: OpinionStatus = from ?? 'candidate';
  const allowed = VALID_TRANSITIONS[effectiveFrom] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(
      `Illegal opinion transition: ${effectiveFrom} → ${to} (allowed: ${allowed.join(', ')})`,
    );
  }
}

/**
 * 纯函数：评审终结时的意见收束决策（dedup + 受理）。
 *
 * 输入：同评审的全部意见（按 createdAt 升序），每项至少含 { id, dimension, issue, status, reviewerId? }
 * 输出：逐条决策，服务层负责落库 + 审计。
 *  - keep: 保持原状态（非 candidate 或已是 accepted/downgraded 的 canonical）
 *  - accept: candidate → accepted
 *  - rejectDuplicate: candidate 且与更早意见同键 → rejected，并入 canonical
 */
export interface FinalizationInput {
  readonly id: string;
  readonly dimension: string;
  readonly issue: string;
  readonly status?: string | null;
  readonly reviewerId?: string | null;
  readonly createdAt?: Date | string;
}

export type FinalizationDecision =
  | { readonly kind: 'keep'; readonly opinionId: string }
  | { readonly kind: 'accept'; readonly opinionId: string }
  | {
      readonly kind: 'rejectDuplicate';
      readonly opinionId: string;
      readonly canonicalId: string;
      readonly reason: string;
    };

export function computeFinalization(opinions: readonly FinalizationInput[]): FinalizationDecision[] {
  const decisions: FinalizationDecision[] = [];
  const canonicalByKey = new Map<string, string>(); // dedupKey → canonical opinionId

  for (const o of opinions) {
    const key = computeDedupKey(o.dimension, o.issue);
    const canonicalId = canonicalByKey.get(key);

    if (canonicalId && canonicalId !== o.id) {
      decisions.push({
        kind: 'rejectDuplicate',
        opinionId: o.id,
        canonicalId,
        reason: `duplicate_of:${canonicalId}`,
      });
      continue;
    }

    // 首个同键意见成为 canonical（仅 candidate/accepted/downgraded 占位；rejected 不占位）
    if (!canonicalId && o.status !== 'rejected') {
      canonicalByKey.set(key, o.id);
    }

    if (o.status === 'candidate' || o.status == null) {
      decisions.push({ kind: 'accept', opinionId: o.id });
    } else {
      decisions.push({ kind: 'keep', opinionId: o.id });
    }
  }

  return decisions;
}

/** 需要追加到 canonical.mergedReviewerIds 的归并映射（rejectDuplicate 决策 → canonical 更新）。 */
export interface MergeRecord {
  readonly canonicalId: string;
  readonly mergedReviewerId: string;
}

export function collectMerges(
  opinions: readonly FinalizationInput[],
  decisions: readonly FinalizationDecision[],
): MergeRecord[] {
  const merges: MergeRecord[] = [];
  for (const d of decisions) {
    if (d.kind !== 'rejectDuplicate') continue;
    const o = opinions.find((x) => x.id === d.opinionId);
    if (o?.reviewerId) {
      merges.push({ canonicalId: d.canonicalId, mergedReviewerId: o.reviewerId });
    }
  }
  return merges;
}

// ════════════════════════════════════════════════════════════════
// NestJS 服务层
// ════════════════════════════════════════════════════════════════

/**
 * 意见生命周期服务：状态迁移 + 终结化 + 审计。
 * 审计经 AuditService.log（.catch 兜底，绝不抛错阻塞主流程，红线 #8）。
 */
@Injectable()
export class OpinionLifecycleService {
  private readonly logger = new Logger(OpinionLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * 评审终结（converge → completed）时调用：
   * 1. 载入全部意见（createdAt 升序）；
   * 2. computeFinalization 决策（dedup + 受理）；
   * 3. 事务内落库（reject 重复 / accept 候选 / 更新 canonical.mergedReviewerIds）；
   * 4. 逐条审计（review.opinion.accepted / review.opinion.rejected.duplicate）。
   * 失败不抛错（记日志），报告侧 isReportable 含 candidate 兜底，不会空白。
   */
  async finalizeReview(reviewId: string, actor?: { tenantId?: string; userId?: string }): Promise<{
    accepted: number;
    rejectedDuplicates: number;
    merged: number;
  }> {
    const opinions = await this.prisma.reviewOpinion.findMany({
      where: { reviewId },
      orderBy: { createdAt: 'asc' },
    });
    if (opinions.length === 0) return { accepted: 0, rejectedDuplicates: 0, merged: 0 };

    const inputs: FinalizationInput[] = opinions.map((o) => ({
      id: o.id,
      dimension: o.dimension,
      issue: o.issue,
      status: o.status ?? null,
      reviewerId: (o as any).reviewerId ?? (o as any).roleVersionId ?? null,
      createdAt: o.createdAt,
    }));

    const decisions = computeFinalization(inputs);
    const merges = collectMerges(inputs, decisions);
    const tenantId = actor?.tenantId ?? '00000000-0000-0000-0000-000000000000';

    const accepted = decisions.filter((d) => d.kind === 'accept').length;
    const rejectedDuplicates = decisions.filter((d) => d.kind === 'rejectDuplicate').length;

    if (accepted === 0 && rejectedDuplicates === 0 && merges.length === 0) {
      return { accepted: 0, rejectedDuplicates: 0, merged: 0 };
    }

    // 合并 canonical 的 mergedReviewerIds
    const canonicalIds = [...new Set(merges.map((m) => m.canonicalId))];
    const canonicals = await this.prisma.reviewOpinion.findMany({
      where: { id: { in: canonicalIds } },
    });
    const canonById = new Map(canonicals.map((c) => [c.id, c]));

    await this.prisma.$transaction(async (tx) => {
      for (const d of decisions) {
        if (d.kind === 'accept') {
          await tx.reviewOpinion.update({
            where: { id: d.opinionId },
            data: { status: 'accepted', resolutionReason: 'finalized:no_debate_challenge' },
          });
        } else if (d.kind === 'rejectDuplicate') {
          await tx.reviewOpinion.update({
            where: { id: d.opinionId },
            data: { status: 'rejected', resolutionReason: d.reason, canonicalOpinionId: d.canonicalId },
          });
        }
      }
      for (const m of merges) {
        const cur = (canonById.get(m.canonicalId) as any)?.mergedReviewerIds as
          | string[]
          | null
          | undefined;
        const list = Array.isArray(cur) ? cur : [];
        if (!list.includes(m.mergedReviewerId)) {
          await tx.reviewOpinion.update({
            where: { id: m.canonicalId },
            data: { mergedReviewerIds: [...list, m.mergedReviewerId] },
          });
        }
      }
    });

    // 审计（异步不阻塞）
    for (const d of decisions) {
      if (d.kind === 'accept') {
        void this.audit.log({
          tenantId,
          userId: actor?.userId ?? null,
          action: 'review.opinion.accepted',
          resource: 'review.opinion',
          resourceId: d.opinionId,
          detail: { reviewId, from: 'candidate', to: 'accepted', reason: 'finalized:no_debate_challenge' },
        });
      } else if (d.kind === 'rejectDuplicate') {
        void this.audit.log({
          tenantId,
          userId: actor?.userId ?? null,
          action: 'review.opinion.rejected.duplicate',
          resource: 'review.opinion',
          resourceId: d.opinionId,
          detail: { reviewId, from: 'candidate', to: 'rejected', canonicalId: d.canonicalId },
        });
      }
    }

    this.logger.log(
      `finalizeReview ${reviewId.substring(0, 8)}: accepted=${accepted} dup=${rejectedDuplicates} merged=${merges.length}`,
    );
    return { accepted, rejectedDuplicates, merged: merges.length };
  }

  /**
   * 单条意见状态迁移（T2 辩论将调用：challenge / accept / reject / downgrade / revise）。
   * 校验非法迁移 → BadRequest；成功写审计。
   */
  async transition(
    reviewId: string,
    opinionId: string,
    to: OpinionStatus,
    reason: string,
    actor?: { tenantId?: string; userId?: string },
  ): Promise<{ ok: boolean; from: string; to: OpinionStatus }> {
    const opinion = await this.prisma.reviewOpinion.findFirst({
      where: { id: opinionId, reviewId },
    });
    if (!opinion) throw new Error('Opinion not found in review');

    const from = (opinion.status ?? 'candidate') as OpinionStatus;
    assertTransition(from, to);

    await this.prisma.reviewOpinion.update({
      where: { id: opinionId },
      data: { status: to, resolutionReason: reason },
    });

    void this.audit.log({
      tenantId: actor?.tenantId ?? '00000000-0000-0000-0000-000000000000',
      userId: actor?.userId ?? null,
      action: `review.opinion.${to}`,
      resource: 'review.opinion',
      resourceId: opinionId,
      detail: { reviewId, from, to, reason },
    });

    return { ok: true, from, to };
  }
}
