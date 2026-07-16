import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptApiKey, decryptApiKey, maskApiKey, assertPublicUrl } from '../../common/utils/crypto';
import type { LlmProvider } from '@prisma/client';

export interface ProviderDto {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  isActive: boolean;
  status: string;
  hasApiKey: boolean;
  apiKeyMasked?: string;
  lastTestAt?: string;
  createdAt: string;
}

@Injectable()
export class LlmProviderService {
  private readonly logger = new Logger(LlmProviderService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Alle Provider — ohne den verschlüsselten Key. */
  async list(): Promise<ProviderDto[]> {
    const rows = await this.prisma.llmProvider.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(this.toDto);
  }

  async get(id: string): Promise<ProviderDto> {
    const row = await this.prisma.llmProvider.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Provider nicht gefunden');
    return this.toDto(row);
  }

  /**
   * Erstelle / aktualisiere einen Provider. apiKey (plain) wird verschlüsselt gespeichert.
   */
  async create(input: {
    name: string;
    provider: string;
    model: string;
    baseUrl: string;
    apiKey?: string;
    activate?: boolean;
  }): Promise<ProviderDto> {
    this.validate(input);
    const apiKeyEnc = input.apiKey ? encryptApiKey(input.apiKey) : null;

    // Wenn dieser Provider aktiviert wird → der Rest deaktivieren
    if (input.activate) {
      await this.prisma.llmProvider.updateMany({ data: { isActive: false } });
    }

    const row = await this.prisma.llmProvider.create({
      data: {
        name: input.name,
        provider: input.provider,
        model: input.model,
        baseUrl: input.baseUrl,
        apiKeyEnc,
        isActive: input.activate ?? false,
        status: 'unknown',
      },
    });
    return this.toDto(row);
  }

  async update(
    id: string,
    input: Partial<{
      name: string;
      provider: string;
      model: string;
      baseUrl: string;
      apiKey: string;
      apiKeyKeep: boolean; // true = bestehenden Key beibehalten, nicht überschreiben
      activate: boolean;
    }>,
  ): Promise<ProviderDto> {
    const existing = await this.prisma.llmProvider.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Provider nicht gefunden');
    if (input.provider || input.model || input.baseUrl) {
      await this.validate({
        name: input.name ?? existing.name,
        provider: input.provider ?? existing.provider,
        model: input.model ?? existing.model,
        baseUrl: input.baseUrl ?? existing.baseUrl,
      });
    }

    if (input.activate) {
      await this.prisma.llmProvider.updateMany({ where: { NOT: { id } }, data: { isActive: false } });
    }

    const data: any = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.provider !== undefined) data.provider = input.provider;
    if (input.model !== undefined) data.model = input.model;
    if (input.baseUrl !== undefined) data.baseUrl = input.baseUrl;
    if (input.apiKey !== undefined && input.apiKey !== '') {
      data.apiKeyEnc = encryptApiKey(input.apiKey);
    } else if (input.apiKeyKeep === false) {
      data.apiKeyEnc = null;
    }
    if (input.activate !== undefined) data.isActive = input.activate;

    const row = await this.prisma.llmProvider.update({ where: { id }, data });
    return this.toDto(row);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.llmProvider.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Provider nicht gefunden');
    if (existing.isActive) {
      throw new BadRequestException('Aktiver Provider kann nicht gelöscht werden — erst deaktivieren.');
    }
    await this.prisma.llmProvider.delete({ where: { id } });
  }

  async setActive(id: string): Promise<ProviderDto> {
    const existing = await this.prisma.llmProvider.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Provider nicht gefunden');
    await this.prisma.llmProvider.updateMany({ data: { isActive: false } });
    const row = await this.prisma.llmProvider.update({ where: { id }, data: { isActive: true } });
    return this.toDto(row);
  }

  /**
   * Echter Verbindungstest: versucht einen /models GET gegen den konfigurierten Endpoint.
   * status wird in DB persistiert (ready | unreachable | unknown).
   */
  async testConnection(id: string): Promise<{ status: string; latencyMs: number; message: string; modelsCount?: number }> {
    const existing = await this.prisma.llmProvider.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Provider nicht gefunden');

    const apiKey = existing.apiKeyEnc ? decryptApiKey(existing.apiKeyEnc) : undefined;
    const started = Date.now();
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const res = await fetch(`${existing.baseUrl.replace(/\/+$/, '')}/models`, { headers, signal: AbortSignal.timeout(8000) });
      const latencyMs = Date.now() - started;
      let modelsCount: number | undefined;
      try {
        const json: any = await res.json();
        modelsCount = Array.isArray(json?.data) ? json.data.length : undefined;
      } catch { /* non-JSON ist auch okay */ }
      const status = res.ok ? 'ready' : 'unreachable';
      await this.prisma.llmProvider.update({ where: { id }, data: { status, lastTestAt: new Date().toISOString() } });
      return { status, latencyMs, message: res.ok ? `Verbunden (${res.status})` : `HTTP ${res.status}`, modelsCount };
    } catch (err: any) {
      const latencyMs = Date.now() - started;
      const status = 'unreachable';
      await this.prisma.llmProvider.update({ where: { id }, data: { status, lastTestAt: new Date().toISOString() } });
      return { status, latencyMs, message: err?.message ?? 'Verbindung fehlgeschlagen' };
    }
  }

  /** Provider-Konfiguration, wie sie der Orchestrator pro Session erwartet. */
  async resolveActiveAdapterEnv(): Promise<Record<string, string>> {
    const active = await this.prisma.llmProvider.findFirst({ where: { isActive: true } });
    if (!active || active.provider === 'mock') return {};
    const env: any = {
      MODEL_PROVIDER: active.provider,
      ALLOW_EXTERNAL_MODEL_CALLS: 'true',
      MODEL_NAME: active.model,
      MODEL_BASE_URL: active.baseUrl,
    };
    if (active.apiKeyEnc) env.MODEL_API_KEY = decryptApiKey(active.apiKeyEnc);
    return env;
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private async validate(input: { name: string; provider: string; model: string; baseUrl: string }) {
    if (!input.name?.trim()) throw new BadRequestException('Name is required');
    // 与 provider-factory 保持一致：mock / lmstudio / openai_compatible 均为一等公民。
    // 注意 lmstudio 仅在 ALLOW_EXTERNAL_MODEL_CALLS=true 时才会真正发请求（Guard 兜底）。
    if (!['openai_compatible', 'mock', 'lmstudio'].includes(input.provider)) {
      throw new BadRequestException(`Unsupported provider: ${input.provider}`);
    }
    if (!input.model?.trim()) throw new BadRequestException('Model is required');
    // SSRF guard：禁止指向内网 / loopback / 云 metadata 的 baseUrl（同步语法校验 + 异步解析校验）。
    // 在 create/update 路径调用，防止租户通过 provider baseUrl 探测内部服务。
    await assertPublicUrl(input.baseUrl);
  }

  private toDto(row: LlmProvider): ProviderDto {
    const hasKey = !!row.apiKeyEnc;
    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      model: row.model,
      baseUrl: row.baseUrl,
      isActive: row.isActive,
      status: row.status,
      hasApiKey: hasKey,
      apiKeyMasked: hasKey && row.apiKeyEnc ? maskApiKey(decryptApiKey(row.apiKeyEnc)) : undefined,
      lastTestAt: row.lastTestAt ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
