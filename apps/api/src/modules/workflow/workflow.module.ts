/**
 * workflow.module.ts — P5 Workflow 模块（Contract §3 / §9）
 *
 * 提供并导出 WorkflowRegistry（被 ScoringService / ReportingService / Orchestrator 注入），
 * 并承载 GET /api/workflows 端点（WorkflowController）。
 */
import { Module } from '@nestjs/common';
import { WorkflowRegistry } from './workflow.registry';
import { WorkflowController } from './workflow.controller';

@Module({
  controllers: [WorkflowController],
  providers: [WorkflowRegistry],
  exports: [WorkflowRegistry],
})
export class WorkflowModule {}
