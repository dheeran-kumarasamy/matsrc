import { describe, expect, it } from 'vitest';
import {
  isIciciUatAvailable,
  getIciciConfig,
  generateICICIHash,
  __detectEnvironmentForTests,
} from './icici-gateway.util';

describe('Gate B: API ICICI Payment Gateway Isolation Matrix', () => {
  it('1. BUILDOHUB_ENV=uat, DATABASE_ENV=uat, VERCEL_ENV=preview, ICICI_PG_ENABLED=true -> Denied (Preview safety)', () => {
    expect(
      isIciciUatAvailable({
        BUILDOHUB_ENV: 'uat',
        DATABASE_ENV: 'uat',
        VERCEL_ENV: 'preview',
        ICICI_PG_ENABLED: 'true',
      } as any)
    ).toBe(false);
  });

  it('2. BUILDOHUB_ENV=uat, DATABASE_ENV=uat, VERCEL_ENV=production, ICICI_PG_ENABLED=true -> Denied (Production safety)', () => {
    expect(
      isIciciUatAvailable({
        BUILDOHUB_ENV: 'uat',
        DATABASE_ENV: 'uat',
        VERCEL_ENV: 'production',
        ICICI_PG_ENABLED: 'true',
      } as any)
    ).toBe(false);
  });

  it('3. BUILDOHUB_ENV=production, DATABASE_ENV=uat, VERCEL_ENV=production, ICICI_PG_ENABLED=true -> Denied', () => {
    expect(
      isIciciUatAvailable({
        BUILDOHUB_ENV: 'production',
        DATABASE_ENV: 'uat',
        VERCEL_ENV: 'production',
        ICICI_PG_ENABLED: 'true',
      } as any)
    ).toBe(false);
  });

  it('4. BUILDOHUB_ENV=uat, DATABASE_ENV=production, VERCEL_ENV=unset, ICICI_PG_ENABLED=true -> Denied (Conflicting configuration)', () => {
    expect(
      isIciciUatAvailable({
        BUILDOHUB_ENV: 'uat',
        DATABASE_ENV: 'production',
        ICICI_PG_ENABLED: 'true',
      } as any)
    ).toBe(false);
  });

  it('5. BUILDOHUB_ENV=development, DATABASE_ENV=development, VERCEL_ENV=unset, ICICI_PG_ENABLED=true -> Denied', () => {
    expect(
      isIciciUatAvailable({
        BUILDOHUB_ENV: 'development',
        DATABASE_ENV: 'development',
        ICICI_PG_ENABLED: 'true',
      } as any)
    ).toBe(false);
  });

  it('6. BUILDOHUB_ENV=uat, DATABASE_ENV=uat, VERCEL_ENV=unset, ICICI_PG_ENABLED=false -> Denied (Master switch off)', () => {
    expect(
      isIciciUatAvailable({
        BUILDOHUB_ENV: 'uat',
        DATABASE_ENV: 'uat',
        ICICI_PG_ENABLED: 'false',
      } as any)
    ).toBe(false);
  });

  it('7. BUILDOHUB_ENV=uat, DATABASE_ENV=uat, VERCEL_ENV=unset, ICICI_PG_ENABLED=true -> Allowed (Explicitly authorised UAT runtime)', () => {
    expect(
      isIciciUatAvailable({
        BUILDOHUB_ENV: 'uat',
        DATABASE_ENV: 'uat',
        ICICI_PG_ENABLED: 'true',
      } as any)
    ).toBe(true);
  });

  it('8. Missing configuration (ICICI_PG_ENABLED=true with no environment vars) -> Denied', () => {
    expect(
      isIciciUatAvailable({
        ICICI_PG_ENABLED: 'true',
      } as any)
    ).toBe(false);
  });

  it('9. DATABASE_ENV=uat alone in development cannot independently authorize payment operations', () => {
    expect(
      isIciciUatAvailable({
        DATABASE_ENV: 'uat',
        BUILDOHUB_ENV: 'development',
        ICICI_PG_ENABLED: 'true',
      } as any)
    ).toBe(false);
  });

  it('10. DATABASE_ENV=uat alone in production cannot independently authorize payment operations', () => {
    expect(
      isIciciUatAvailable({
        DATABASE_ENV: 'uat',
        NODE_ENV: 'production',
        ICICI_PG_ENABLED: 'true',
      } as any)
    ).toBe(false);
  });
});

describe('getIciciConfig & detectEnvironment in apps/api', () => {
  it('enforces VERCEL_ENV=preview as staging in API', () => {
    expect(__detectEnvironmentForTests({ VERCEL_ENV: 'preview', BUILDOHUB_ENV: 'uat' } as any)).toBe('staging');
  });

  it('enforces VERCEL_ENV=production as production in API', () => {
    expect(__detectEnvironmentForTests({ VERCEL_ENV: 'production', BUILDOHUB_ENV: 'uat' } as any)).toBe('production');
  });

  it('detects uat when BUILDOHUB_ENV=uat and DATABASE_ENV is matching in API', () => {
    expect(__detectEnvironmentForTests({ BUILDOHUB_ENV: 'uat', DATABASE_ENV: 'uat' } as any)).toBe('uat');
  });

  it('fails closed to development when BUILDOHUB_ENV=uat but DATABASE_ENV conflicts in API', () => {
    expect(__detectEnvironmentForTests({ BUILDOHUB_ENV: 'uat', DATABASE_ENV: 'production' } as any)).toBe('development');
  });

  it('returns valid config only for authorized UAT with complete credentials', () => {
    const validEnv = {
      BUILDOHUB_ENV: 'uat',
      DATABASE_ENV: 'uat',
      ICICI_PG_ENABLED: 'true',
      ICICI_PG_MERCHANT_ID: 'MERCHANT_1',
      ICICI_PG_AGGREGATOR_ID: 'AGG_1',
      ICICI_PG_SECRET_KEY: 'SECRET_1',
      ICICI_PG_BASE_URL: 'https://pgpayuat.icicibank.com',
    };
    const config = getIciciConfig(validEnv as any);
    expect(config).not.toBeNull();
    expect(config?.merchantId).toBe('MERCHANT_1');
    expect(config?.aggregatorId).toBe('AGG_1');
  });

  it('returns null if any required credential is missing even in authorized UAT', () => {
    const missingSecretEnv = {
      BUILDOHUB_ENV: 'uat',
      DATABASE_ENV: 'uat',
      ICICI_PG_ENABLED: 'true',
      ICICI_PG_MERCHANT_ID: 'MERCHANT_1',
      ICICI_PG_AGGREGATOR_ID: 'AGG_1',
      // ICICI_PG_SECRET_KEY missing
    };
    expect(getIciciConfig(missingSecretEnv as any)).toBeNull();
  });

  it('generates consistent HMAC-SHA256 signature', () => {
    const payload = { b: '2', a: '1', secureHash: 'ignored' };
    const hash1 = generateICICIHash(payload, 'test-key');
    const hash2 = generateICICIHash({ a: '1', b: '2' }, 'test-key');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });
});

