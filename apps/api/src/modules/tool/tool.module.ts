/**
 * tool.module.ts — P4 Tool 层模块（Contract §2 / Implementation §3.1）
 *
 * 提供 ToolRegistryImpl（mock stub），并 export 以便 ReviewsModule 注入到
 * ReviewOrchestrator（tool_node 使用）。
 *
 * 红线：不引入真实 MCP SDK；不发起任何真实网络调用。
 */
import { Module } from '@nestjs/common';
import { ToolRegistryImpl } from './tool.registry';

@Module({
  providers: [ToolRegistryImpl],
  exports: [ToolRegistryImpl],
})
export class ToolModule {}
