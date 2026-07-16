import { Controller, Get, Post, Patch, Body, Param, Delete, HttpCode } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { LlmProviderService, ProviderDto } from './llm-provider.service';

/**
 * Admin-Provider-Verwaltung (Produktisierung).
 *
 * GET    /api/llm-providers              — Liste aller Provider (ohne Keys)            [role.read]
 * POST   /api/llm-providers              — Neuer Provider                              [admin.access]
 * PATCH  /api/llm-providers/:id          — Update (name / url / key)                   [admin.access]
 * DELETE /api/llm-providers/:id          — Löschen (nur wenn inaktiv)                  [admin.access]
 * POST   /api/llm-providers/:id/activate — Als aktiven Provider setzen                 [admin.access]
 * POST   /api/llm-providers/:id/test     — Echter /models-Verbindungstest              [admin.access]
 * GET    /api/llm-providers/status       — Aktiver Provider + Verbindungsstatus        [role.read]
 *
 * RBAC：只读端点需 role.read（列 provider 摘要，不含明文 key）；
 *       变更型端点需 admin.access（创建/改/删/激活 provider + 发起真实连接测试）。
 *       PermissionsGuard = OR 语义；未标注 @RequirePermissions 的路由不被此 Guard 拦截。
 */

@Controller('llm-providers')
export class LlmProviderController {
  constructor(private readonly service: LlmProviderService) {}

  @Get('status')
  @RequirePermissions('role.read')
  async status(): Promise<{
    hasActive: boolean;
    active: ProviderDto | null;
    envConfigured: boolean;
  }> {
    const all = await this.service.list();
    const active = all.find((p) => p.isActive) ?? null;
    // Außerdem prüfen: ist ein Key über .env vorhanden (Abwärtskompatibilität)?
    const envConfigured = !!(process.env.MODEL_API_KEY && process.env.MODEL_PROVIDER && process.env.MODEL_PROVIDER !== 'mock');
    return { hasActive: !!active, active, envConfigured };
  }

  @Get()
  @RequirePermissions('role.read')
  list(): Promise<ProviderDto[]> {
    return this.service.list();
  }

  @Get(':id')
  @RequirePermissions('role.read')
  get(@Param('id') id: string): Promise<ProviderDto> {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions('admin.access')
  create(@Body() body: any): Promise<ProviderDto> {
    return this.service.create({
      name: body.name,
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      activate: body.activate,
    });
  }

  @Patch(':id')
  @RequirePermissions('admin.access')
  update(
    @Param('id') id: string,
    @Body() body: any,
  ): Promise<ProviderDto> {
    return this.service.update(id, {
      name: body.name,
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      apiKeyKeep: body.apiKeyKeep,
      activate: body.activate,
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('admin.access')
  async remove(@Param('id') id: string): Promise<void> {
    await this.service.remove(id);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions('admin.access')
  activate(@Param('id') id: string): Promise<ProviderDto> {
    return this.service.setActive(id);
  }

  @Post(':id/test')
  @RequirePermissions('admin.access')
  test(@Param('id') id: string): Promise<{ status: string; latencyMs: number; message: string; modelsCount?: number }> {
    return this.service.testConnection(id);
  }
}
