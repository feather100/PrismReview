/**
 * idempotency.ts — turn 幂等查询（Contract §3.2 + Codex 指令 1）
 *
 * 关键：幂等查询按**语义元组** (reviewId, roleVersionId, round) 查 ReviewTurn，
 * 不依赖 idempotencyKey 字符串完全相等。这天然覆盖：
 *   - 3 段键  `${reviewId}::${roleVersionId}::${round}`
 *   - 4 段键  `${reviewId}::${roleVersionId}::${round}::${N}`（9.3 消歧后缀，72 行）
 * 只匹配 3 段 `== '...::1'` 会漏 4 段键 → 幂等失效 → P0。本文件为唯一权威查询。
 */
import { PrismaService } from '../../../prisma/prisma.service';

const TERMINAL = ['completed', 'failed', 'timeout'] as const;

export interface TurnIdempotencyInput {
  reviewId: string;
  roleVersionId: string;
  round: number;
}

export interface TurnIdempotencyResult {
  found: boolean;
  turnId?: string;
}

export async function findExistingTerminalTurn(
  prisma: PrismaService,
  input: TurnIdempotencyInput,
): Promise<TurnIdempotencyResult> {
  const existing = await prisma.reviewTurn.findFirst({
    where: {
      reviewId: input.reviewId,
      roleVersionId: input.roleVersionId,
      round: input.round,
      status: { in: [...TERMINAL] },
    },
    select: { id: true },
  });
  return { found: !!existing, turnId: existing?.id };
}
