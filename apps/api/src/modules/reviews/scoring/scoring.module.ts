/**
 * scoring.module.ts — P5 Scoring 模块（Contract §4 / §9）
 *
 * 提供并导出 ScoringService（被 ReportingService 注入）。
 * PrismaService 由全局 PrismaModule 提供；WorkflowRegistry 由 WorkflowModule 提供。
 */
import { Module } from '@nestjs/common';
import { ScoringService } from './scoring.service';
import { WorkflowModule } from '../../workflow/workflow.module';

@Module({
  imports: [WorkflowModule],
  providers: [ScoringService],
  exports: [ScoringService],
})
export class ScoringModule {}
