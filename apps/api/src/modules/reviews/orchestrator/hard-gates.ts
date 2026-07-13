/**
 * hard-gates.ts — 硬闸解析与每评审员派发门控（Contract §5.2）
 *
 * max_turns_per_reviewer 泛化自既有 MODEL_PILOT_MAX_ROLES（默认 3），
 * 与 §5.2 对齐。注意：这是「单评审员最大发言数」门控，与「角色列表长度」
 * （applyPilotRoleCap 在 lmstudio pilot 模式下的裁剪）是**两个不同语义**。
 * round-1 各评审员各发言一次，本门控不触发；仅当同一评审员被派发 > N 次时拦截。
 */
import { PrismaService } from '../../../prisma/prisma.service';
import { DEFAULT_HARD_GATES, HardGates } from './moderator';

/** 从 MODEL_PILOT_MAX_ROLES 解析 max_turns_per_reviewer（默认 3）。 */
export function resolveHardGates(): HardGates {
  const raw = process.env.MODEL_PILOT_MAX_ROLES;
  let maxTurns = DEFAULT_HARD_GATES.maxTurnsPerReviewer;
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const parsed = parseInt(String(raw), 10);
    maxTurns = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HARD_GATES.maxTurnsPerReviewer;
  }
  return { ...DEFAULT_HARD_GATES, maxTurnsPerReviewer: maxTurns };
}

export interface DispatchGateInput {
  reviewId: string;
  roleVersionId: string;
  maxTurns: number;
}

/**
 * 每评审员硬闸：该 roleVersionId 在本 review 已派发 turn 数 >= maxTurns 时拒绝。
 * 单轮各评审员 1 次 → 不触发；验证脚本用 3 次 + 第 4 次派发演示拦截。
 */
export async function shouldDispatchTurn(
  prisma: PrismaService,
  input: DispatchGateInput,
): Promise<boolean> {
  const count = await prisma.reviewTurn.count({
    where: { reviewId: input.reviewId, roleVersionId: input.roleVersionId },
  });
  return count < input.maxTurns;
}
