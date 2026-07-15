import { Module } from '@nestjs/common';
import { PromptServiceImpl } from './prompt.service';
import { PromptsController } from './prompts.controller';

/**
 * PromptModule（Sprint 5.1 P3 + 产品化 HTTP 控制层）。
 * 提供 PromptService 实现（版本化 prompt 模板注册表 + 四层组装），
 * 暴露 /api/prompts CRUD 端点。
 */
@Module({
  controllers: [PromptsController],
  providers: [PromptServiceImpl],
  exports: [PromptServiceImpl],
})
export class PromptModule {}
