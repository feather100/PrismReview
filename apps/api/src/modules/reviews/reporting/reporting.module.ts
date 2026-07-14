/**
 * reporting.module.ts — P5 Reporting 模块（Contract §5 / §9）
 *
 * 提供并导出 ReportingService（被 ReviewsService 注入以委托 getReport / exportMarkdown）。
 * 依赖 ScoringService（评分）+ WorkflowRegistry（解析 workflow）。
 */
import { Module } from '@nestjs/common';
import { ReportingService } from './reporting.service';
import { ScoringModule } from '../scoring/scoring.module';
import { WorkflowModule } from '../../workflow/workflow.module';

@Module({
  imports: [ScoringModule, WorkflowModule],
  providers: [ReportingService],
  exports: [ReportingService],
})
export class ReportingModule {}
