import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { ReviewsGateway } from './reviews.gateway';
import { QueueService } from './queue/queue.service';
import { ReviewOrchestrator } from './orchestrator/review-orchestrator';
import { PostgresCheckpointer } from './orchestrator/postgres-checkpointer';
import { MockModerator } from './orchestrator/moderator';

@Module({
  controllers: [ReviewsController],
  providers: [
    ReviewsService,
    ReviewsGateway,
    QueueService,
    ReviewOrchestrator,
    PostgresCheckpointer,
    MockModerator,
  ],
  exports: [ReviewsService, QueueService, ReviewOrchestrator],
})
export class ReviewsModule {}
