import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSupplierAppUrl, validateServiceUrl } from './listings';
import { getSiteUrl } from './site-url';

describe('Service URL Resolution & Preview Isolation Guard', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SUPPLIER_APP_URL;
    delete process.env.NEXT_PUBLIC_SUPPLIER_APP_URL;
    delete process.env.SUPPLIER_PORTAL_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXTAUTH_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;
    delete process.env.VERCEL_ENV;
    delete process.env.BUILDOHUB_ENV;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getSupplierAppUrl', () => {
    it('strictly forbids fallback to production in Preview environment (throws error)', () => {
      process.env.VERCEL_ENV = 'preview';
      expect(() => getSupplierAppUrl()).toThrowError(
        /SUPPLIER_APP_URL must be configured in preview and production environments/
      );
    });

    it('strictly forbids unconfigured fallback in Production environment (fails closed)', () => {
      (process.env as any).NODE_ENV = 'production';
      expect(() => getSupplierAppUrl()).toThrowError(
        /SUPPLIER_APP_URL must be configured in preview and production environments/
      );
    });

    it('uses explicitly configured SUPPLIER_APP_URL in preview', () => {
      process.env.VERCEL_ENV = 'preview';
      process.env.SUPPLIER_APP_URL = 'https://matsrc-supplier-git-preview.vercel.app/';
      expect(getSupplierAppUrl()).toBe('https://matsrc-supplier-git-preview.vercel.app');
    });

    it('uses NEXT_PUBLIC_SUPPLIER_APP_URL when configured', () => {
      process.env.NEXT_PUBLIC_SUPPLIER_APP_URL = 'https://supplier-preview.example.com';
      expect(getSupplierAppUrl()).toBe('https://supplier-preview.example.com');
    });

    it('uses SUPPLIER_PORTAL_URL when configured', () => {
      process.env.SUPPLIER_PORTAL_URL = 'https://supplier-portal.internal';
      expect(getSupplierAppUrl()).toBe('https://supplier-portal.internal');
    });

    it('defaults to localhost:3001 in development/test', () => {
      (process.env as any).NODE_ENV = 'test';
      expect(getSupplierAppUrl()).toBe('http://localhost:3001');
    });
  });

  describe('validateServiceUrl cross-environment boundaries', () => {
    it('rejects Preview environment attempting to connect to Production URL', () => {
      expect(() =>
        validateServiceUrl('https://supplier.matsrc.in', { vercelEnv: 'preview' })
      ).toThrowError(/Preview environment cannot connect to Production service URL/);

      expect(() =>
        validateServiceUrl('https://matsrc-supplier.vercel.app', { vercelEnv: 'preview' })
      ).toThrowError(/Preview environment cannot connect to Production service URL/);
    });

    it('rejects Preview environment attempting to connect to UAT URL', () => {
      expect(() =>
        validateServiceUrl('https://uat.matsrc.in', { vercelEnv: 'preview' })
      ).toThrowError(/Preview environment cannot connect to UAT service URL/);
    });

    it('rejects Production environment attempting to connect to Preview URL', () => {
      expect(() =>
        validateServiceUrl('https://matsrc-supplier-git-preview.vercel.app', { vercelEnv: 'production' })
      ).toThrowError(/Production environment cannot connect to Preview service URL/);
    });

    it('rejects Production environment attempting to connect to UAT URL', () => {
      expect(() =>
        validateServiceUrl('https://uat.matsrc.in', { vercelEnv: 'production' })
      ).toThrowError(/Production environment cannot connect to UAT service URL/);
    });

    it('rejects UAT environment attempting to connect to Production URL', () => {
      expect(() =>
        validateServiceUrl('https://supplier.matsrc.in', { buildohubEnv: 'uat' })
      ).toThrowError(/UAT environment cannot connect to Production service URL/);
    });

    it('rejects invalid or malformed URL formats', () => {
      expect(() => validateServiceUrl('not-a-url')).toThrowError(/Invalid service URL format/);
      expect(() => validateServiceUrl('ftp://example.com')).toThrowError(/Unsupported protocol/);
    });

    it('accepts valid preview-to-preview service URL', () => {
      expect(
        validateServiceUrl('https://matsrc-supplier-preview.vercel.app', { vercelEnv: 'preview' })
      ).toBe('https://matsrc-supplier-preview.vercel.app');
    });
  });

  describe('getSiteUrl', () => {
    it('fails closed in preview if no URL is configured', () => {
      process.env.VERCEL_ENV = 'preview';
      expect(() => getSiteUrl()).toThrowError(
        /NEXT_PUBLIC_APP_URL or VERCEL_URL must be configured in preview environment/
      );
    });

    it('uses VERCEL_URL in preview when present', () => {
      process.env.VERCEL_ENV = 'preview';
      process.env.VERCEL_URL = 'matsrc-web-preview.vercel.app';
      expect(getSiteUrl()).toBe('https://matsrc-web-preview.vercel.app');
    });

    it('returns localhost:3000 in test/development when unconfigured', () => {
      (process.env as any).NODE_ENV = 'test';
      expect(getSiteUrl()).toBe('http://localhost:3000');
    });
  });
});
