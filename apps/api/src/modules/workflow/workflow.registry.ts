/**
 * workflow.registry.ts — P5 WorkflowRegistry（Contract §3）
 *
 * Workflow = 配置对象（**不是**新的 Graph 节点）：4 个 preset 通过既有 `Review.mode`
 * （语义重命名为 `workflowId`）驱动参数化现有 P1 节点（rounds / phase / tools / weights）。
 *
 * 红线（Contract §9 / §12.2）：
 *  - 纯 TS 常量 + JSON 列，**不引入新运行时依赖**（无 workflow engine 库）。
 *  - 评分权重可审计：resolve 出的配置用于 ScoringService 写 `Review.scoringConfig` 快照。
 *  - 不新增数据库表（workflow 预设写在纯 TS 常量中）。
 */
import { Injectable } from '@nestjs/common';
import type { TurnPhase } from '../reviews/orchestrator/graph-runtime';
import type { ToolType } from '../tool/tool.registry';

export type WorkflowId = 'enterprise' | 'code-review' | 'research' | 'thesis';

export interface ScoringWeights {
  /** dimension → weight (0~1, 各维度权重之和 = 1) */
  readonly byDimension: Record<string, number>;
  /** fallback: 未指定权重的维度分配策略 */
  readonly fallback: 'uniform' | 'confidence' | 'risk';
}

export interface VerdictThresholds {
  /** >= threshold → approved */
  readonly approved: number;
  /** >= threshold → conditionally_approved（< conditionallyApproved → rejected） */
  readonly conditionallyApproved: number;
}

export interface WorkflowConfig {
  readonly id: WorkflowId;
  readonly nameZh: string;
  readonly description: string;
  readonly maxRounds: number;
  readonly minRounds: number;
  /** >= 此轮方允许 tool_approval / continue_debate */
  readonly debateAfterRound: number;
  /** round-1 默认 ['round_robin']；可配 ['round_robin','round_robin','debate'] */
  readonly turnPhasePattern: TurnPhase[];
  /** Moderator 可用工具子集（P4 ToolType[] 子集） */
  readonly availableTools: ToolType[];
  readonly scoringWeights: ScoringWeights;
  readonly verdictThresholds: VerdictThresholds;
}

export const PRESET_WORKFLOWS: Record<WorkflowId, WorkflowConfig> = {
  enterprise: {
    id: 'enterprise',
    nameZh: '企业评审',
    description: '通用企业方案评审（P1 默认编排）',
    maxRounds: 3,
    minRounds: 1,
    debateAfterRound: 2,
    turnPhasePattern: ['round_robin'],
    availableTools: ['knowledge_search'],
    scoringWeights: {
      byDimension: {
        架构合理性: 0.25,
        投入产出分析: 0.2,
        交付风险: 0.15,
        数据安全与合规: 0.25,
        用户体验: 0.15,
      },
      fallback: 'uniform',
    },
    verdictThresholds: { approved: 75, conditionallyApproved: 50 },
  },
  'code-review': {
    id: 'code-review',
    nameZh: '代码审查',
    description: 'Pull Request / 代码变更评审',
    maxRounds: 2,
    minRounds: 1,
    debateAfterRound: 1, // P5 (Sprint 5.3) 回归兼容：协作式 code-review 允许 round-1 立即辩论（与 9.5b 多轮测试兼容）
    turnPhasePattern: ['round_robin'],
    availableTools: ['code_analysis', 'knowledge_search'],
    scoringWeights: {
      byDimension: {
        代码质量: 0.3,
        安全风险: 0.3,
        性能影响: 0.2,
        可维护性: 0.2,
      },
      fallback: 'risk',
    },
    verdictThresholds: { approved: 80, conditionallyApproved: 55 },
  },
  research: {
    id: 'research',
    nameZh: '科研评审',
    description: '研究方案 / 基金申请评审',
    maxRounds: 3,
    minRounds: 2,
    debateAfterRound: 2,
    turnPhasePattern: ['round_robin', 'round_robin', 'debate'],
    availableTools: ['knowledge_search', 'calculation'],
    scoringWeights: {
      byDimension: {
        创新性: 0.3,
        可行性: 0.25,
        科学价值: 0.25,
        方法论: 0.2,
      },
      fallback: 'uniform',
    },
    verdictThresholds: { approved: 70, conditionallyApproved: 45 },
  },
  thesis: {
    id: 'thesis',
    nameZh: '论文评审',
    description: '学位论文 / 期刊审稿',
    maxRounds: 2,
    minRounds: 2,
    debateAfterRound: 2,
    turnPhasePattern: ['round_robin', 'debate'],
    availableTools: ['knowledge_search'],
    scoringWeights: {
      byDimension: {
        原创性: 0.25,
        技术深度: 0.25,
        写作质量: 0.2,
        实验设计: 0.3,
      },
      fallback: 'uniform',
    },
    verdictThresholds: { approved: 75, conditionallyApproved: 50 },
  },
};

/**
 * 旧 `Review.mode` 值 → workflowId 兼容映射（Contract §3.5）。
 *  - 'round_robin' → enterprise（完全兼容 P1 默认）
 *  - 'free_debate' → code-review
 */
export const LEGACY_MODE_MAP: Readonly<Record<string, WorkflowId>> = {
  round_robin: 'enterprise',
  free_debate: 'code-review',
};

export interface WorkflowValidationResult {
  readonly ok: boolean;
  readonly errors: string[];
}

@Injectable()
export class WorkflowRegistry {
  /** 获取 workflow 配置（preset 优先；未识别 → enterprise 兜底）。 */
  resolve(workflowId: string): WorkflowConfig {
    if (workflowId && workflowId in PRESET_WORKFLOWS) {
      return PRESET_WORKFLOWS[workflowId as WorkflowId];
    }
    const legacy = LEGACY_MODE_MAP[workflowId];
    if (legacy) return PRESET_WORKFLOWS[legacy];
    // 未知值兜底 → enterprise（Contract §3.5）
    return PRESET_WORKFLOWS.enterprise;
  }

  /** 列出可用 preset（供前端/新建评审下拉）。返回深拷贝，避免调用方篡改常量。 */
  listPresets(): WorkflowConfig[] {
    return Object.values(PRESET_WORKFLOWS).map((c) => ({ ...c }));
  }

  /**
   * 验证自定义 workflow 配置（维度权重之和 = 1）。
   * Config §4 红线：权重可审计，自定义配置必须经此校验。
   */
  validateCustom(config: Partial<WorkflowConfig>): WorkflowValidationResult {
    const errors: string[] = [];

    const weights = config?.scoringWeights?.byDimension;
    if (!weights || typeof weights !== 'object' || Object.keys(weights).length === 0) {
      errors.push('scoringWeights.byDimension 必须非空');
    } else {
      let sum = 0;
      for (const [dim, w] of Object.entries(weights)) {
        if (typeof w !== 'number' || Number.isNaN(w) || w < 0 || w > 1) {
          errors.push(`维度 "${dim}" 权重非法（须为 0~1 数值）`);
        } else {
          sum += w;
        }
      }
      if (Math.abs(sum - 1) > 1e-6) {
        errors.push(`维度权重之和须 = 1（当前 = ${Number(sum.toFixed(4))}）`);
      }
    }

    const t = config?.verdictThresholds;
    if (t) {
      if (typeof t.approved !== 'number' || typeof t.conditionallyApproved !== 'number') {
        errors.push('verdictThresholds.approved / conditionallyApproved 须为数值');
      } else if (t.approved <= t.conditionallyApproved) {
        errors.push('verdictThresholds.approved 须 > conditionallyApproved');
      }
    }

    return { ok: errors.length === 0, errors };
  }
}
