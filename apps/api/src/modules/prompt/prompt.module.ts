import { Module } from '@nestjs/common';
import { PromptServiceImpl } from './prompt.service';

/**
 * PromptModule（Sprint 5.1 P3）
 * 提供 PromptService 实现（版本化 prompt 模板注册表 + 四层组装）。
 * 不引入新依赖；prisma 由全局 PrismaModule 提供。
 */
@Module({
  providers: [PromptServiceImpl],
  exports: [PromptServiceImpl],
})
export class PromptModule {}
