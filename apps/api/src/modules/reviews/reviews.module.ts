import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { ReviewsGateway } from './reviews.gateway';
import { QueueService } from './queue/queue.service';
import { ReviewOrchestrator } from './orchestrator/review-orchestrator';
import { PostgresCheckpointer } from './orchestrator/postgres-checkpointer';
import { MockModerator } from './orchestrator/moderator';
import { QualityService } from './quality/quality.service';
import { QualityController } from './quality/quality.controller';
import { PromptModule } from '../prompt/prompt.module';
import { MemoryModule } from '../memory/memory.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';

@Module({
  imports: [PromptModule, MemoryModule, KnowledgeModule],
  controllers: [ReviewsController, QualityController],
  providers: [
    ReviewsService,
    ReviewsGateway,
    QueueService,
    ReviewOrchestrator,
    PostgresCheckpointer,
    MockModerator,
    QualityService,
  ],
  exports: [ReviewsService, QueueService, ReviewOrchestrator, QualityService],
})
export class ReviewsModule {}
