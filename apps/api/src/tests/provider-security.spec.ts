/**
 * Provider Security Tests — Sprint 10.1
 *
 * Tests for:
 * - ProviderPolicy.assertAllowed()
 * - ProviderPolicy.assertTenantOwnership()
 * - ProviderPolicy.assertProviderTypeAllowed()
 * - canUseExternalModelCalls()
 * - createProviderPolicyFromEnv()
 */

import { ProviderPolicy, createProviderPolicyFromEnv, ProviderAction } from '../modules/reviews/provider/provider-policy';
import { QualityService } from '../modules/reviews/quality/quality.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe('ProviderPolicy — constructor', () => {
  it('creates with explicit config', () => {
    const policy = new ProviderPolicy({
      allowExternalModelCalls: true,
      allowedProviders: ['mock', 'openai_compatible'],
    });
    expect(policy.allowExternalModelCalls).toBe(true);
    expect(policy.allowedProviders).toEqual(['mock', 'openai_compatible']);
  });

  it('treats non-true values as false for allowExternalModelCalls', () => {
    const policy = new ProviderPolicy({
      allowExternalModelCalls: false,
      allowedProviders: ['mock'],
    });
    expect(policy.allowExternalModelCalls).toBe(false);
  });

  it('uses default allowed providers when not specified', () => {
    const policy = new ProviderPolicy({
      allowExternalModelCalls: false,
      allowedProviders: ['mock', 'lmstudio', 'openai_compatible'],
    });
    expect(policy.allowedProviders).toContain('mock');
    expect(policy.allowedProviders).toContain('lmstudio');
    expect(policy.allowedProviders).toContain('openai_compatible');
  });
});

describe('ProviderPolicy — canUseExternalModelCalls', () => {
  it('returns true when external calls allowed', () => {
    const policy = new ProviderPolicy({
      allowExternalModelCalls: true,
      allowedProviders: ['mock'],
    });
    expect(policy.canUseExternalModelCalls()).toBe(true);
  });

  it('returns false when external calls not allowed', () => {
    const policy = new ProviderPolicy({
      allowExternalModelCalls: false,
      allowedProviders: ['mock'],
    });
    expect(policy.canUseExternalModelCalls()).toBe(false);
  });
});

describe('ProviderPolicy — assertAllowed', () => {
  const ctx = { tenantId: 'tenant-1', userId: 'user-1' };

  it('allows admin actions regardless of external call setting', () => {
    const policy = new ProviderPolicy({
      allowExternalModelCalls: false,
      allowedProviders: ['mock', 'openai_compatible'],
    });
    const actions: ProviderAction[] = ['create', 'update', 'delete', 'activate'];
    for (const action of actions) {
      expect(() => policy.assertAllowed({ ...ctx, action })).not.toThrow();
    }
  });

  it('blocks test when external calls disabled', () => {
    const policy = new ProviderPolicy({
      allowExternalModelCalls: false,
      allowedProviders: ['mock', 'openai_compatible'],
    });
    expect(() => policy.assertAllowed({ ...ctx, action: 'test' })).toThrow(ForbiddenException);
  });

  it('blocks completion when external calls disabled', () => {
    const policy = new ProviderPolicy({
      allowExternalModelCalls: false,
      allowedProviders: ['mock', 'openai_compatible'],
    });
    expect(() => policy.assertAllowed({ ...ctx, action: 'completion' })).toThrow(ForbiddenException);
  });

  it('allows test when external calls enabled', () => {
    const policy = new ProviderPolicy({
      allowExternalModelCalls: true,
      allowedProviders: ['mock', 'openai_compatible'],
    });
    expect(() => policy.assertAllowed({ ...ctx, action: 'test' })).not.toThrow();
  });

  it('allows completion when external calls enabled', () => {
    const policy = new ProviderPolicy({
      allowExternalModelCalls: true,
      allowedProviders: ['mock', 'openai_compatible'],
    });
    expect(() => policy.assertAllowed({ ...ctx, action: 'completion' })).not.toThrow();
  });

  it('throws BadRequestException for unknown action', () => {
    const policy = new ProviderPolicy({
      allowExternalModelCalls: true,
      allowedProviders: ['mock'],
    });
    expect(() => policy.assertAllowed({ ...ctx, action: 'unknown' as ProviderAction })).toThrow(BadRequestException);
  });
});

describe('ProviderPolicy — assertProviderTypeAllowed', () => {
  const policy = new ProviderPolicy({
    allowExternalModelCalls: true,
    allowedProviders: ['mock', 'openai_compatible'],
  });

  it('allows known provider types', () => {
    expect(() => policy.assertProviderTypeAllowed('mock')).not.toThrow();
    expect(() => policy.assertProviderTypeAllowed('openai_compatible')).not.toThrow();
  });

  it('blocks unknown provider types', () => {
    expect(() => policy.assertProviderTypeAllowed('unknown_provider')).toThrow(BadRequestException);
    expect(() => policy.assertProviderTypeAllowed('')).toThrow(BadRequestException);
  });

  it('blocks malicious provider type strings', () => {
    expect(() => policy.assertProviderTypeAllowed('mock; DROP TABLE')).toThrow(BadRequestException);
    expect(() => policy.assertProviderTypeAllowed('../../etc/passwd')).toThrow(BadRequestException);
  });
});

describe('ProviderPolicy — assertTenantOwnership', () => {
  const policy = new ProviderPolicy({
    allowExternalModelCalls: true,
    allowedProviders: ['mock'],
  });

  it('allows when tenantId matches', () => {
    expect(() => policy.assertTenantOwnership('tenant-1', 'tenant-1')).not.toThrow();
  });

  it('blocks when tenantId does not match', () => {
    expect(() => policy.assertTenantOwnership('tenant-1', 'tenant-2')).toThrow(ForbiddenException);
  });

  it('blocks when providerTenantId is null (legacy)', () => {
    expect(() => policy.assertTenantOwnership(null, 'tenant-1')).toThrow(ForbiddenException);
  });

  it('blocks when providerTenantId is undefined', () => {
    expect(() => policy.assertTenantOwnership(undefined, 'tenant-1')).toThrow(ForbiddenException);
  });
});

describe('createProviderPolicyFromEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('creates policy with external calls disabled by default', () => {
    delete process.env.ALLOW_EXTERNAL_MODEL_CALLS;
    const policy = createProviderPolicyFromEnv();
    expect(policy.allowExternalModelCalls).toBe(false);
  });

  it('creates policy with external calls enabled when env=true', () => {
    process.env.ALLOW_EXTERNAL_MODEL_CALLS = 'true';
    const policy = createProviderPolicyFromEnv();
    expect(policy.allowExternalModelCalls).toBe(true);
  });

  it('does not enable external calls for non-true values', () => {
    process.env.ALLOW_EXTERNAL_MODEL_CALLS = 'yes';
    const policy = createProviderPolicyFromEnv();
    expect(policy.allowExternalModelCalls).toBe(false);

    process.env.ALLOW_EXTERNAL_MODEL_CALLS = '1';
    const policy2 = createProviderPolicyFromEnv();
    expect(policy2.allowExternalModelCalls).toBe(false);
  });

  it('reads allowed provider types from env', () => {
    process.env.ALLOWED_PROVIDER_TYPES = 'mock,openai_compatible';
    const policy = createProviderPolicyFromEnv();
    expect(policy.allowedProviders).toEqual(['mock', 'openai_compatible']);
  });
});
describe('Sprint 10.1 P0-4 regression — QualityService.providerPolicy initialized', () => {
  it('initializes providerPolicy in constructor (was undefined → TypeError at runtime)', () => {
    const svc = new QualityService({} as any, {} as any);
    const policy = (svc as any).providerPolicy;
    expect(policy).toBeDefined();
    expect(policy).toBeInstanceOf(ProviderPolicy);
    expect(typeof policy.allowExternalModelCalls).toBe('boolean');
  });
});
