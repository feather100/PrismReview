import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LlmProviderService } from './llm-provider.service';
import { LlmProviderController } from './llm-provider.controller';

@Module({
  imports: [PrismaModule],
  controllers: [LlmProviderController],
  providers: [LlmProviderService],
  exports: [LlmProviderService],
})
export class LlmProviderModule {}
