/**
 * graph-runtime.ts — 自研最小 graph runtime 类型（Contract §2）
 *
 * 范式对齐 LangGraph（显式状态机 + checkpoint + 条件路由），但不引入
 * @langchain/langgraph 全量依赖（Sprint 9.0 决策 1）。
 *
 * 节点 = 普通 TS 函数；边 = 静态 / 条件路由；State = 强类型 ReviewState；
 * Checkpointer 接口由 Postgres 后端实现（§6）。
 */
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { ModelAdapter } from '../provider/model-adapter';

// ── Review status（Contract §2.2 / §1.1 规范集）──
// 9.5a P2-4：补齐 9.3 物理枚举的保留值 `interrupted` / `archived`（§1.1 补充保留态）。
//   - interrupted：非规范补充态（HITL 暂停，`interrupted → running` 恢复），非终态。
//   - archived：生命周期标志（终态后归档），按 9.3 枚举语义归为终态集合。
export type ReviewStatus =
  | 'created'
  | 'diagnosed'
  | 'running'
  | 'summarized'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'interrupted'
  | 'archived';

// Turn 生命周期状态（Contract §3.3）
export type TurnStatus =
  | 'created'
  | 'prompt_assembled'
  | 'model_invoked'
  | 'parsed'
  | 'validated'
  | 'persisted'
  | 'failed';

export type TurnPhase = 'round_robin' | 'debate';

export interface TurnRecord {
  readonly turnId: string;
  readonly reviewerId: string; // = roleVersionId（既有 ReviewTurn.roleVersionId）
  readonly round: number;
  readonly phase: TurnPhase;
  readonly status: TurnStatus;
  readonly opinionRef?: string; // ReviewOpinion.id
}

export type ModeratorDecisionType =
  | 'advance_round'
  | 'continue_debate'
  | 'converge'
  | 'force_stop'
  | 'terminate_proposal';

export interface ModeratorDecisionRef {
  readonly decisionId: string;
  readonly round: number;
  readonly decisionType: ModeratorDecisionType;
}

// 用量账本（P1 仅 token/round 计数；cost 在 P2 启用，恒为 0）
export interface UsageLedger {
  readonly totalTokens: number;
  readonly totalRounds: number;
  readonly turnsByReviewer: Record<string, number>; // reviewerId -> 发言数
  readonly totalCost: number; // P1 恒为 0（mock）
}

export interface ReviewState {
  readonly reviewId: string;
  status: ReviewStatus;
  round: number; // 当前轮次（1-based）
  currentNodeId: string; // 当前 graph 节点（= 状态机阶段）
  turns: TurnRecord[];
  moderatorDecisions: ModeratorDecisionRef[];
  usage: UsageLedger;
  // 收敛信号（P1 mock 用确定性启发式；P3 起接 rolling summary）
  convergenceScore?: number;
  // 最近一次 Moderator 决策类型（供 summarized 条件边读取，P2-3）；9.5a 新增。
  lastDecisionType?: ModeratorDecisionType;
  updatedAt: string; // ISO
}

// ── Checkpoint（Contract §2.3 / §6）──
export interface Checkpoint {
  readonly id: string;
  readonly reviewId: string;
  readonly nodeId: string; // 转移后的节点（状态）
  readonly stateJson: string; // ReviewState 序列化
  readonly sequence: number; // 单调递增，用于取最新
  readonly createdAt: string;
}

export interface Checkpointer {
  save(reviewId: string, nodeId: string, state: ReviewState): Promise<Checkpoint>;
  // 崩了 load 取 sequence 最大者 resume
  load(reviewId: string): Promise<{ nodeId: string; state: ReviewState } | null>;
}

// ── Node / Edge / Graph（Contract §2.1）──
export type Node<S extends ReviewState> = (
  state: Readonly<S>,
  ctx: NodeCtx,
) => Promise<Partial<S>>;

export interface StaticEdge {
  readonly kind: 'static';
  readonly from: string;
  readonly to: string;
}

export interface ConditionalEdge {
  readonly kind: 'conditional';
  readonly from: string;
  readonly route: (state: Readonly<ReviewState>) => string;
}

export type Edge = StaticEdge | ConditionalEdge;

export interface Graph<S extends ReviewState> {
  readonly nodes: Record<string, Node<S>>;
  readonly edges: readonly Edge[];
  readonly start: string; // 入口节点 id（如 'created'）
}

// ── P2/P3 注入位（Contract §2.4）──
// ModelAdapter is the real abstraction introduced in Sprint 2.1
// (provider/model-adapter.ts). P1 nodes do not consume it yet; it is
// injected into NodeCtx at module assembly for P2 readiness.
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface MemoryService {
  /* P3 */
}
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface PromptService {
  /* P3 */
}

export interface NodeCtx {
  readonly logger: Logger; // P1 必有
  readonly tracer: unknown; // P1 仅 stub；P6 接 OTel
  readonly checkpointer: Checkpointer; // P1 必有（Postgres）
  // 以下为 P2/P3 注入位（P1 不注入，节点判空）
  readonly modelAdapter?: ModelAdapter; // P2
  readonly memoryService?: MemoryService; // P3
  readonly promptService?: PromptService; // P3
  // 既有服务复用（包装，不替换）
  readonly queue: QueueService; // 既有内存队列（queue.service.ts）
  readonly prisma: PrismaService; // 既有 ORM
}

export const TERMINAL_STATUSES: ReadonlySet<ReviewStatus> = new Set<ReviewStatus>([
  'completed',
  'failed',
  'aborted',
  // P2-4：archived 按 9.3 物理枚举语义归为终态（生命周期归档标志）。
  // interrupted 刻意不在其中（HITL 暂停，可恢复 → running）。
  'archived',
]);

export function isTerminalStatus(s: string): s is ReviewStatus {
  return TERMINAL_STATUSES.has(s as ReviewStatus);
}
