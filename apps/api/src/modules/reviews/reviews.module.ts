import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { ReviewsGateway } from './reviews.gateway';
import { QueueService } from './queue/queue.service';

@Module({
  controllers: [ReviewsController],
  providers: [ReviewsService, ReviewsGateway, QueueService],
  exports: [ReviewsService, QueueService],
})
export class ReviewsModule {}
