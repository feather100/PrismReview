/**
 * tool.registry.ts — P4 Tool 层（Contract §2，标准 Gate）
 *
 * 设计原则（Contract §2.1）：
 *  - 工具仅经 MCP：不直连任何外部服务；MCP server 是唯一工具提供者（P4 仅预留接口位）。
 *  - Moderator 审批：Moderator 决定本轮可用哪几个 tool（防止 tool 滥用）。
 *  - Reviewer 禁止自由调研：reviewer 不调外部工具（A2A 反模式，红线 #6）。
 *  - mock 默认：默认不调真实 MCP server（工具调用返回空或 stub）。
 *
 * 红线：不引入真实 `@modelcontextprotocol/sdk`；`executeTool` 为 mock stub，
 * 不发起任何真实网络调用。真实 MCP 接入须独立 Gate（P4 不启用）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// ── Tool 类型（Contract §2.2）──
export type ToolType =
  | 'knowledge_search' // KB/RAG 检索（via MCP，替代 P3 预留的 KnowledgeService 接入位）
  | 'code_analysis' // 代码静态分析（via MCP）
  | 'web_search' // 外部搜索（via MCP，可选）
  | 'calculation' // 计算/估算（via MCP，可选）
  | 'custom'; // 用户自定义工具（via MCP）

export interface ToolDefinition {
  readonly name: string; // "knowledge_search"
  readonly type: ToolType;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>; // 工具输入 schema
  readonly mcpServerRef: string; // MCP server 标识（env 配置名，如 "knowledge"）
  readonly enabled: boolean;
}

export interface ToolCallRequest {
  readonly id: string;
  readonly reviewId: string;
  readonly round: number;
  readonly requestedBy: 'moderator'; // 只有 Moderator 可以请求工具（A2A 禁止 reviewer 直接调）
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly approvedBy: string; // ModeratorDecision.id
  readonly status: 'pending' | 'executing' | 'completed' | 'failed' | 'denied';
  readonly result?: unknown;
  readonly deniedReason?: string;
  readonly createdAt: string;
  readonly completedAt?: string;
}

// 提交参数：省略系统填充字段
export type ExecuteToolInput = Omit<ToolCallRequest, 'id' | 'createdAt' | 'status'>;

export interface ToolRegistry {
  /** 注册工具定义（启动时或动态）；name 存在则 update。 */
  registerTool(def: ToolDefinition): Promise<ToolDefinition>;

  /** 列出 Moderator 本轮可选的工具清单（附启用状态）。 */
  listAvailableTools(round: number, phase: string): Promise<ToolDefinition[]>;

  /** 执行工具调用（经 Moderator 审批后）。mock 下返回 stub 结果，不调真实 MCP。 */
  executeTool(request: ExecuteToolInput): Promise<ToolCallRequest>;

  /** 获取审批日志。 */
  getApprovalLog(reviewId: string, round?: number): Promise<ToolCallRequest[]>;
}

@Injectable()
export class ToolRegistryImpl implements ToolRegistry {
  private readonly logger = new Logger(ToolRegistryImpl.name);

  constructor(private readonly prisma: PrismaService) {}

  async registerTool(def: ToolDefinition): Promise<ToolDefinition> {
    const existing = await this.prisma.toolDefinitionRecord.findUnique({
      where: { name: def.name },
    });
    if (existing) {
      const updated = await this.prisma.toolDefinitionRecord.update({
        where: { name: def.name },
        data: {
          type: def.type,
          description: def.description,
          inputSchema: def.inputSchema as object,
          mcpServerRef: def.mcpServerRef,
          enabled: def.enabled,
        },
      });
      return this.toDefinition(updated);
    }
    const created = await this.prisma.toolDefinitionRecord.create({
      data: {
        name: def.name,
        type: def.type,
        description: def.description,
        inputSchema: def.inputSchema as object,
        mcpServerRef: def.mcpServerRef,
        enabled: def.enabled,
      },
    });
    return this.toDefinition(created);
  }

  async listAvailableTools(_round: number, _phase: string): Promise<ToolDefinition[]> {
    // mock：返回 DB 中 enabled=true 的工具（默认未注册则为空列表，符合 P4 stub 行为）。
    const records = await this.prisma.toolDefinitionRecord.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
    });
    return records.map((r) => this.toDefinition(r));
  }

  async executeTool(request: ExecuteToolInput): Promise<ToolCallRequest> {
    // mock stub：不发起任何真实 MCP 调用（红线：P4 不启真实 MCP server）。
    // 直接创建 ToolCallRequest(status='completed') + result 为 stub。
    const result = this.stubResult(request.toolName, request.input);
    const created = await this.prisma.toolCallRequest.create({
      data: {
        reviewId: request.reviewId,
        round: request.round,
        requestedBy: 'moderator',
        toolName: request.toolName,
        input: (request.input ?? {}) as object,
        approvedBy: request.approvedBy ?? null,
        status: 'completed',
        result: result as object,
        completedAt: new Date(),
      },
    });
    this.logger.log(
      `Tool executed (mock stub): review=${request.reviewId.substring(0, 8)} tool=${request.toolName} round=${request.round}`,
    );
    return this.toRequest(created);
  }

  async getApprovalLog(reviewId: string, round?: number): Promise<ToolCallRequest[]> {
    const where: { reviewId: string; round?: number } = { reviewId };
    if (typeof round === 'number') where.round = round;
    const records = await this.prisma.toolCallRequest.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });
    return records.map((r) => this.toRequest(r));
  }

  // ── mock 结果 ──
  private stubResult(toolName: string, _input: Record<string, unknown>): unknown {
    switch (toolName) {
      case 'knowledge_search':
        // 替代 P3 预留的 KnowledgeService 接入位；mock 返回空 chunks。
        return { chunks: [] };
      case 'code_analysis':
        return { findings: [] };
      case 'web_search':
        return { results: [] };
      case 'calculation':
        return { value: null };
      default:
        return { stub: true, tool: toolName };
    }
  }

  private toDefinition(r: any): ToolDefinition {
    return {
      name: r.name,
      type: r.type as ToolType,
      description: r.description,
      inputSchema: (r.inputSchema as Record<string, unknown>) ?? {},
      mcpServerRef: r.mcpServerRef,
      enabled: r.enabled,
    };
  }

  private toRequest(r: any): ToolCallRequest {
    return {
      id: r.id,
      reviewId: r.reviewId,
      round: r.round,
      requestedBy: 'moderator',
      toolName: r.toolName,
      input: (r.input as Record<string, unknown>) ?? {},
      approvedBy: r.approvedBy ?? undefined,
      status: r.status,
      result: r.result ?? undefined,
      deniedReason: r.deniedReason ?? undefined,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      completedAt: r.completedAt
        ? r.completedAt instanceof Date
          ? r.completedAt.toISOString()
          : String(r.completedAt)
        : undefined,
    };
  }
}
