import { Module } from '@nestjs/common';
import { MemoryServiceImpl } from './memory.service';

/**
 * MemoryModule（Sprint 5.1 P3）
 * 提供 MemoryService 实现（蒸馏 profile + project memory + rolling summary）。
 * 不引入新依赖；prisma 由全局 PrismaModule 提供。
 */
@Module({
  providers: [MemoryServiceImpl],
  exports: [MemoryServiceImpl],
})
export class MemoryModule {}
