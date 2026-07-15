import { Controller, Get, Post, Patch, Body, Param, Delete, HttpCode } from '@nestjs/common';
import { LlmProviderService, ProviderDto } from './llm-provider.service';

/**
 * Admin-Provider-Verwaltung (Produktisierung).
 *
 * GET    /api/llm-providers              — Liste aller Provider (ohne Keys)
 * POST   /api/llm-providers              — Neuer Provider
 * PATCH  /api/llm-providers/:id          — Update (name / url / key)
 * DELETE /api/llm-providers/:id          — Löschen (nur wenn inaktiv)
 * POST   /api/llm-providers/:id/activate — Als aktiven Provider setzen
 * POST   /api/llm-providers/:id/test     — Echter /models-Verbindungstest
 * GET    /api/llm-providers/status       — Aktiver Provider + Verbindungsstatus
 */

@Controller('llm-providers')
export class LlmProviderController {
  constructor(private readonly service: LlmProviderService) {}

  @Get('status')
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
  list(): Promise<ProviderDto[]> {
    return this.service.list();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ProviderDto> {
    return this.service.get(id);
  }

  @Post()
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
  async remove(@Param('id') id: string): Promise<void> {
    await this.service.remove(id);
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(@Param('id') id: string): Promise<ProviderDto> {
    return this.service.setActive(id);
  }

  @Post(':id/test')
  test(@Param('id') id: string): Promise<{ status: string; latencyMs: number; message: string; modelsCount?: number }> {
    return this.service.testConnection(id);
  }
}
