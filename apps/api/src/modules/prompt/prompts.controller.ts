import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PromptServiceImpl } from './prompt.service';
import type { PromptLayer } from './prompt.service';

/**
 * Prompt 模板注册表 HTTP 控制层（产品化）。
 *
 * 端点：
 *   GET  /api/prompts                         — 列出模板（可按 roleCode / layer 过滤）
 *   POST /api/prompts                         — 注册新版本模板
 *   GET  /api/prompts/:roleCode/history       — 某角色全部版本历史
 *   POST /api/prompts/:roleCode/rollback      — 回滚到指定版本（创建新版本，内容复制）
 *
 * 全部端点要求 role.read（查看）/ role.write（注册回滚）。
 */
@Controller('prompts')
export class PromptsController {
  constructor(private readonly promptService: PromptServiceImpl) {}

  @Get()
  @RequirePermissions('role.read')
  async list(
    @CurrentUser() _user: AuthUser,
    @Query('roleCode') roleCode?: string,
    @Query('layer') layer?: PromptLayer,
  ) {
    if (roleCode && layer) {
      const active = await this.promptService.getActiveTemplate(roleCode, layer);
      return active ? [active] : [];
    }
    if (roleCode) {
      return this.promptService.getTemplateHistory(roleCode);
    }
    // 无过滤：扫描常用角色返回 active 模板
    const codes = ['CTO', 'CFO', 'PMO', 'Compliance', 'UserAdvocate'];
    const out: any[] = [];
    for (const code of codes) {
      const layers: PromptLayer[] = ['base', 'task', 'context', 'format'];
      for (const layer of layers) {
        const t = await this.promptService.getActiveTemplate(code, layer);
        if (t) out.push(t);
      }
    }
    return out;
  }

  @Post()
  @RequirePermissions('role.write')
  async register(
    @CurrentUser() user: AuthUser,
    @Body() body: { roleCode: string; layer: PromptLayer; content: string; version?: string; description?: string },
  ) {
    return this.promptService.registerTemplate({
      roleCode: body.roleCode,
      layer: body.layer,
      content: body.content,
      version: body.version,
      metadata: {
        description: body.description ?? '',
        createdBy: user.id,
        schemaVersion: '1.0',
      },
    });
  }

  @Get(':roleCode/history')
  @RequirePermissions('role.read')
  async history(@Param('roleCode') roleCode: string, @Query('layer') layer?: PromptLayer) {
    return this.promptService.getTemplateHistory(roleCode, layer);
  }

  @Post(':roleCode/rollback')
  @RequirePermissions('role.write')
  async rollback(
    @Param('roleCode') roleCode: string,
    @Body() body: { layer: PromptLayer; version: string },
  ) {
    return this.promptService.rollbackTo(roleCode, body.layer, body.version);
  }
}
