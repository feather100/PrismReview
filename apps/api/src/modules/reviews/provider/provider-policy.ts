/**
 * provider-policy.ts — Unified Provider access policy (Sprint 10.1)
 *
 * Centralizes ALL provider-related access decisions:
 *   - Whether external model calls are allowed (server-side trust boundary)
 *   - Whether a specific provider action is permitted for a tenant
 *   - Tenant ownership validation for providers
 *
 * Business code MUST NOT set ALLOW_EXTERNAL_MODEL_CALLS='true' directly.
 * All provider operations must go through this policy.
 */

import { BadRequestException, ForbiddenException } from '@nestjs/common';

export type ProviderAction = 'create' | 'update' | 'delete' | 'activate' | 'test' | 'completion';

export interface ProviderActionContext {
  tenantId: string;
  userId: string;
  action: ProviderAction;
}

export interface ProviderPolicyConfig {
  /** Whether external (real) model calls are allowed at all. MUST come from server env, never from user input. */
  allowExternalModelCalls: boolean;
  /** Allowed provider types. Defaults to ['mock', 'lmstudio', 'openai_compatible']. */
  allowedProviders: string[];
}

const DEFAULT_ALLOWED_PROVIDERS = ['mock', 'lmstudio', 'openai_compatible'];

export class ProviderPolicy {
  readonly allowExternalModelCalls: boolean;
  readonly allowedProviders: string[];

  constructor(config: ProviderPolicyConfig) {
    // Defensive: only accept boolean from trusted server config
    this.allowExternalModelCalls = config.allowExternalModelCalls === true;
    this.allowedProviders = config.allowedProviders || DEFAULT_ALLOWED_PROVIDERS;
  }

  /**
   * Assert that a provider action is allowed for the given context.
   * Throws ForbiddenException or BadRequestException on violation.
   */
  assertAllowed(ctx: ProviderActionContext): void {
    // Action-specific checks
    switch (ctx.action) {
      case 'create':
      case 'update':
      case 'delete':
      case 'activate':
        // Admin-level actions — no additional policy beyond RBAC (handled by @RequirePermissions)
        break;
      case 'test':
      case 'completion':
        // These involve external network calls — enforce the server-side switch
        if (!this.allowExternalModelCalls) {
          throw new ForbiddenException(
            'External model calls are disabled. Set ALLOW_EXTERNAL_MODEL_CALLS=true on the server to enable.',
          );
        }
        break;
      default:
        throw new BadRequestException('Unknown provider action: ' + ctx.action);
    }
  }

  /**
   * Check if a provider type is in the allowed list.
   */
  isProviderTypeAllowed(providerType: string): boolean {
    return this.allowedProviders.includes(providerType);
  }

  /**
   * Assert that a provider type is allowed.
   */
  assertProviderTypeAllowed(providerType: string): void {
    if (!this.isProviderTypeAllowed(providerType)) {
      throw new BadRequestException(
        'Provider type "' + providerType + '" is not allowed. Allowed: ' + this.allowedProviders.join(', '),
      );
    }
  }

  /**
   * Check if external model calls are permitted.
   * This is the single source of truth — business code must not bypass.
   */
  canUseExternalModelCalls(): boolean {
    return this.allowExternalModelCalls;
  }

  /**
   * Assert that the provider belongs to the given tenant.
   * Throws ForbiddenException on mismatch.
   */
  assertTenantOwnership(providerTenantId: string | null | undefined, requesterTenantId: string): void {
    if (!providerTenantId) {
      // Legacy providers without tenantId — deny access from other tenants
      throw new ForbiddenException('Provider has no tenant ownership — access denied');
    }
    if (providerTenantId !== requesterTenantId) {
      throw new ForbiddenException('Provider does not belong to your tenant');
    }
  }
}

/**
 * Factory: create ProviderPolicy from server environment.
 * This is the ONLY place that reads ALLOW_EXTERNAL_MODEL_CALLS from env.
 */
export function createProviderPolicyFromEnv(): ProviderPolicy {
  // Strict: only 'true' (string) from env enables external calls
  const allowExternal = process.env.ALLOW_EXTERNAL_MODEL_CALLS === 'true';
  const allowedProviders = (process.env.ALLOWED_PROVIDER_TYPES || 'mock,lmstudio,openai_compatible')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);
  return new ProviderPolicy({ allowExternalModelCalls: allowExternal, allowedProviders });
}
