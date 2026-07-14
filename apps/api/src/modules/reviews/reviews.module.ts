import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { ReviewsGateway } from './reviews.gateway';
import { QueueService } from './queue/queue.service';
import { ReviewOrchestrator } from './orchestrator/review-orchestrator';
import { PostgresCheckpointer } from './orchestrator/postgres-checkpointer';
import { MODERATOR_TOKEN } from './orchestrator/moderator';
import { createModeratorWithEnv } from './orchestrator/llm-moderator';
import { QualityService } from './quality/quality.service';
import { QualityController } from './quality/quality.controller';
import { PromptModule } from '../prompt/prompt.module';
import { MemoryModule } from '../memory/memory.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ToolModule } from '../tool/tool.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { ReportingModule } from './reporting/reporting.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PromptServiceImpl } from '../prompt/prompt.service';

@Module({
  imports: [PromptModule, MemoryModule, KnowledgeModule, ToolModule, WorkflowModule, ReportingModule],
  controllers: [ReviewsController, QualityController],
  providers: [
    ReviewsService,
    ReviewsGateway,
    QueueService,
    ReviewOrchestrator,
    PostgresCheckpointer,
    QualityService,
    // P4 (Sprint 5.2)：env-gated Moderator（MODERATOR_PROVIDER=llm + ALLOW_EXTERNAL=true → LlmModerator，否则 MockModerator fail-closed）。
    {
      provide: MODERATOR_TOKEN,
      useFactory: (prisma: PrismaService, promptService: PromptServiceImpl) =>
        createModeratorWithEnv(prisma, promptService),
      inject: [PrismaService, PromptServiceImpl],
    },
  ],
  exports: [ReviewsService, QueueService, ReviewOrchestrator, QualityService],
})
export class ReviewsModule {}
