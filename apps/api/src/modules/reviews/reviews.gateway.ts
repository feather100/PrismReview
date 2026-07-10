import { Injectable, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

interface EnrichedRole {
  roleId: string; roleCode: string; roleName: string; weight: number; removable: boolean;
};

interface DbTurnData {
  turnId: string; turnIndex: number; roleCode: string; roleName: string; roleId: string;
  status: string; startedAt: string | null; completedAt: string | null;
  opinion: { dimension: string; riskLevel: string; issue: string; recommendation: string; confidenceScore: number } | null;
};

const MOCK_AGENT_CONTENT: Record<string, { dimension: string; riskLevel: string; content: string; recommendation: string; confidenceScore: number }> = {
  CTO: { dimension: '架构合理性', riskLevel: 'high', content: '当前方案在架构层面存在单点故障风险，核心链路未设置熔断降级机制。建议采用微服务架构拆分关键模块，每个服务独立部署和扩缩容。同时需补充详细的容灾演练方案和故障恢复SLA。', recommendation: '将非关键路径改为异步事件驱动，为核心链路设置超时和熔断，补充容灾演练方案。', confidenceScore: 78 },
  CFO: { dimension: '投入产出分析', riskLevel: 'medium', content: '方案初期投入较高，但长期ROI可期。建议分阶段投入，第一阶段验证核心价值后再全面铺开。需关注人力成本和运维成本的持续支出。', recommendation: '制定分阶段投入计划，首阶段聚焦核心功能验证，设定明确的ROI评估指标和检查点。', confidenceScore: 72 },
  PMO: { dimension: '交付风险', riskLevel: 'medium', content: '排期计划较为紧张，关键路径上存在外部依赖风险。建议预留20%缓冲时间应对未知问题，同时明确各阶段交付物和验收标准。', recommendation: '增加20%排期缓冲，明确外部依赖的对接人和时间表，设置里程碑检查点。', confidenceScore: 65 },
  Compliance: { dimension: '数据安全与合规', riskLevel: 'high', content: '方案涉及用户数据处理，需确保符合数据出境相关法规要求。建议在上线前完成数据分类分级和隐私影响评估，补充数据加密和访问控制措施。', recommendation: '完成数据分类分级和隐私影响评估，确保数据加密传输和存储，建立数据访问审计机制。', confidenceScore: 80 },
  UserAdvocate: { dimension: '用户体验', riskLevel: 'low', content: '方案在用户体验方面考虑较为周全，但建议增加新手引导和帮助文档，降低用户学习成本。同时关注页面加载性能对用户体验的影响。', recommendation: '补充新手引导流程，优化关键页面加载性能至2秒内。', confidenceScore: 70 },
};

const DEFAULT_DURATION_MS = 3000;

@Injectable()
export class ReviewsGateway {
  private readonly logger = new Logger(ReviewsGateway.name);

  constructor(private readonly prisma: PrismaService) {}

  getDiagnoseStream(reviewId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const stages = [
        { percent: 10, stage: '正在分析方案领域标签...' },
        { percent: 30, stage: '正在匹配评审角色...' },
        { percent: 55, stage: '正在评估风险维度...' },
        { percent: 80, stage: '正在计算诊断置信度...' },
        { percent: 100, stage: '诊断完成' },
      ];
      let index = 0;
      const interval = setInterval(() => {
        if (index >= stages.length) {
          subscriber.next({ type: 'complete', data: { reviewId, status: 'completed' } } as MessageEvent);
          clearInterval(interval); subscriber.complete(); return;
        }
        subscriber.next({ type: 'progress', data: { percent: stages[index].percent, stage: stages[index].stage } } as MessageEvent);
        index++;
      }, 1500);
      return () => { clearInterval(interval); };
    });
  }

  /** Mock SSE meeting stream — used when no DB turns exist. */
  getMeetingStream(reviewId: string, sessionId: string, roles: EnrichedRole[]): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const mockRoles = roles.slice(0, 3);
      if (mockRoles.length === 0) { subscriber.error(new Error('No roles to simulate')); return; }

      let seq = 0;
      const ts = () => new Date().toISOString();
      const queue: Array<{ type: string; data: any }> = [];
      const push = (type: string, payload: any) => {
        seq++;
        queue.push({ type, data: { eventId: `${reviewId}-${seq}`, reviewId, sessionId, type, timestamp: ts(), sequence: seq, payload } });
      };

      push('meeting.started', { status: 'running', totalAgents: mockRoles.length, totalTurnsPlanned: mockRoles.length });
      push('heartbeat', { timestamp: ts() });
      for (let t = 0; t < mockRoles.length; t++) {
        const role = mockRoles[t];
        const turnId = `${reviewId}-turn-${t + 1}`;
        const mc = MOCK_AGENT_CONTENT[role.roleCode] || MOCK_AGENT_CONTENT.CTO;
        push('agent.turn.started', { turnId, roleId: role.roleId, roleCode: role.roleCode, roleName: role.roleName, turnIndex: t + 1 });
        push('agent.message.delta', { turnId, roleCode: role.roleCode, delta: mc.content });
        push('agent.message.completed', { turnId, roleCode: role.roleCode, content: mc.content, riskLevel: mc.riskLevel, dimension: mc.dimension, recommendation: mc.recommendation, confidenceScore: mc.confidenceScore });
        push('agent.turn.completed', { turnId, roleCode: role.roleCode, durationMs: DEFAULT_DURATION_MS });
      }
      push('meeting.completed', { status: 'completed', totalTurns: mockRoles.length });

      const totalEvents = queue.length;
      let index = 0;
      const interval = setInterval(() => {
        if (index >= totalEvents) { clearInterval(interval); subscriber.complete(); return; }
        subscriber.next({ type: queue[index].type, data: queue[index].data } as MessageEvent);
        index++;
      }, 400);
      return () => { clearInterval(interval); };
    });
  }

  /**
   * SSE meeting stream from DB review_turns / review_opinions.
   * For completed reviews: replay all turns, then meeting.completed.
   * For running reviews with partial turns: replay completed turns, poll DB every 2s,
   * send heartbeat when idle, meeting.completed only when all turns terminal.
   */
  getMeetingStreamFromDb(
    reviewId: string, sessionId: string, initialTurns: DbTurnData[], reviewStatus: string, expectedTurnCount: number,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let seq = 0;
      const ts = () => new Date().toISOString();
      const sentTurnIds = new Set<string>();
      let hasCompleted = false; // Prevent double meeting.completed
      let pollTimer: NodeJS.Timeout | null = null;
      let overallTimer: NodeJS.Timeout | null = null;
      let noProgressSince = Date.now();
      let heartbeatCount = 0;

      const push = (type: string, payload: any) => {
        seq++;
        subscriber.next({ type, data: { eventId: `${reviewId}-${seq}`, reviewId, sessionId, type, timestamp: ts(), sequence: seq, payload } } as MessageEvent);
      };

      const sendTurn = (turn: DbTurnData) => {
        if (sentTurnIds.has(turn.turnId)) return;
        sentTurnIds.add(turn.turnId);

        const o = turn.opinion;
        push('agent.turn.started', { turnId: turn.turnId, roleId: turn.roleId, roleCode: turn.roleCode, roleName: turn.roleName, turnIndex: turn.turnIndex });
        if (o) {
          push('agent.message.delta', { turnId: turn.turnId, roleCode: turn.roleCode, delta: o.recommendation });
          push('agent.message.completed', { turnId: turn.turnId, roleCode: turn.roleCode, content: o.issue + ' ' + o.recommendation, riskLevel: o.riskLevel, dimension: o.dimension, recommendation: o.recommendation, confidenceScore: o.confidenceScore });
        }
        push('agent.turn.completed', { turnId: turn.turnId, roleCode: turn.roleCode, durationMs: DEFAULT_DURATION_MS });
        noProgressSince = Date.now();
      };

      const sendMeetingComplete = () => {
        if (hasCompleted) return;
        hasCompleted = true;
        push('meeting.completed', { status: 'completed', totalTurns: sentTurnIds.size });
        if (pollTimer) clearTimeout(pollTimer);
        if (overallTimer) clearTimeout(overallTimer);
        subscriber.complete();
      };

      // Phase 1: Replay initial completed turns
      push('meeting.started', { status: 'running', totalAgents: expectedTurnCount, totalTurnsPlanned: expectedTurnCount });
      push('heartbeat', { timestamp: ts() });

      for (const turn of initialTurns) {
        if (turn.status === 'completed') sendTurn(turn);
      }

      // Phase 2: If all turns already terminal → done
      const initialTerminalCount = initialTurns.filter(t => ['completed', 'failed', 'timeout'].includes(t.status)).length;
      if (initialTerminalCount >= expectedTurnCount) {
        sendMeetingComplete();
        return;
      }

      // Phase 3: Poll DB for new turns (running + partial)
      if (reviewStatus === 'running') {
        const poll = async () => {
          try {
            const dbTurns: any[] = await this.prisma.reviewTurn.findMany({
              where: { reviewId },
              include: { opinions: true },
              orderBy: { turnIndex: 'asc' },
            });

            const versionIds = [...new Set(dbTurns.map(t => t.roleVersionId).filter(Boolean))];
            const roles = await this.prisma.agentRole.findMany({
              where: { activeVersionId: { in: versionIds } },
              select: { id: true, code: true, name: true, activeVersionId: true },
            });
            const versionToRole = new Map(roles.map(r => [r.activeVersionId, { id: r.id as string, code: r.code, name: r.name }]));

            const newTurns = dbTurns
              .filter(t => ['completed', 'failed', 'timeout'].includes(t.status) && !sentTurnIds.has(t.id))
              .map(t => ({
                turnId: t.id,
                turnIndex: t.turnIndex,
                roleCode: versionToRole.get(t.roleVersionId)?.code ?? 'unknown',
                roleName: versionToRole.get(t.roleVersionId)?.name ?? 'Unknown',
                roleId: versionToRole.get(t.roleVersionId)?.id ?? '',
                status: t.status,
                startedAt: t.startedAt?.toISOString?.() ?? null,
                completedAt: t.completedAt?.toISOString?.() ?? null,
                opinion: t.opinions[0] ? {
                  dimension: t.opinions[0].dimension,
                  riskLevel: t.opinions[0].riskLevel,
                  issue: t.opinions[0].issue,
                  recommendation: t.opinions[0].recommendation,
                  confidenceScore: t.opinions[0].confidenceScore,
                } : null,
              }));

            // Send new turns
            for (const turn of newTurns) sendTurn(turn);

            const terminalCount = dbTurns.filter(t => ['completed', 'failed', 'timeout'].includes(t.status)).length;

            // Check if done
            if (terminalCount >= expectedTurnCount) {
              sendMeetingComplete();
              return;
            }

            // Check progress timeout
            const idleTime = Date.now() - noProgressSince;
            if (idleTime > 120000) {
              push('meeting.error', { code: 'TIMEOUT', message: 'No progress for 120s' });
              subscriber.complete();
              return;
            }

            // Check overall timeout
            if (idleTime > 300000) {
              this.logger.warn(`SSE timeout for review ${reviewId.substring(0, 8)}`);
              subscriber.complete();
              return;
            }

            // Send heartbeat every 3 polls
            heartbeatCount++;
            if (heartbeatCount % 3 === 0 && newTurns.length === 0) {
              push('heartbeat', { timestamp: ts() });
            }

            // Schedule next poll
            pollTimer = setTimeout(poll, 2000);
          } catch (err) {
            this.logger.error(`Poll error: ${err.message}`);
            push('meeting.error', { code: 'POLL_ERROR', message: err.message });
            subscriber.complete();
          }
        };

        // Start polling
        pollTimer = setTimeout(poll, 2000);
      }

      // Overall timeout (300s)
      overallTimer = setTimeout(() => {
        if (!hasCompleted) {
          this.logger.warn(`SSE 300s timeout review ${reviewId.substring(0, 8)}`);
          if (pollTimer) clearTimeout(pollTimer);
          push('meeting.error', { code: 'OVERALL_TIMEOUT', message: 'SSE connection timed out' });
          subscriber.complete();
        }
      }, 300000);

      return () => {
        if (pollTimer) clearTimeout(pollTimer);
        if (overallTimer) clearTimeout(overallTimer);
      };
    });
  }
}
