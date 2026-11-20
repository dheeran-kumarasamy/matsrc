import { describe, it, expect, beforeEach } from 'vitest';
import { isAllowedAdminProxyRoute, containsPathTraversal } from './admin-proxy';
import {
  getAdminServiceHeaders,
  signAdminUserAssertion,
  DEV_ADMIN_SERVICE_SECRET,
  DEV_ASSERTION_SECRET,
} from './service-auth';
import * as crypto from 'crypto';

describe('Admin Proxy Route Allowlist & Security Controls', () => {
  describe('Path traversal defense', () => {
    it('detects directory traversal patterns including multi-encoded sequences', () => {
      expect(containsPathTraversal('admin/../../etc/passwd')).toBe(true);
      expect(containsPathTraversal('admin/%2e%2e/secret')).toBe(true);
      expect(containsPathTraversal('admin/%252e%252e/secret')).toBe(true);
      expect(containsPathTraversal('admin/%252e%252e')).toBe(true);
      expect(containsPathTraversal('admin/..\\cmd')).toBe(true);
      expect(containsPathTraversal('admin%5ccmd')).toBe(true);
      expect(containsPathTraversal('admin%2f%2e%2e')).toBe(true);
      expect(containsPathTraversal('admin/./dashboard')).toBe(true);
      expect(containsPathTraversal('admin//dashboard')).toBe(true);
      expect(containsPathTraversal('admin/dashboard\0extra')).toBe(true);
      expect(containsPathTraversal('admin/dashboard%00extra')).toBe(true);
      expect(containsPathTraversal('admin/dashboard%2500extra')).toBe(true);
      expect(containsPathTraversal('admin/dashboard')).toBe(false);
      expect(containsPathTraversal('admin/catalog/category')).toBe(false);
    });

    it('rejects traversal attempts in isAllowedAdminProxyRoute', () => {
      expect(isAllowedAdminProxyRoute('admin/../../etc/passwd', 'GET')).toBe(false);
      expect(isAllowedAdminProxyRoute('admin/%2e%2e/dashboard', 'GET')).toBe(false);
      expect(isAllowedAdminProxyRoute('admin/%252e%252e/dashboard', 'GET')).toBe(false);
    });
  });

  describe('isAllowedAdminProxyRoute Exact Allowlist', () => {
    it('allows public catalog and ticker', () => {
      expect(isAllowedAdminProxyRoute('public/catalog/category', 'GET')).toBe(true);
      expect(isAllowedAdminProxyRoute('public/ticker', 'GET')).toBe(true);
      expect(isAllowedAdminProxyRoute('public/listings', 'GET')).toBe(true);
      expect(isAllowedAdminProxyRoute('public/catalog/category', 'POST')).toBe(false);
    });

    it('allows advance payments operations', () => {
      expect(isAllowedAdminProxyRoute('admin/advance-payments', 'GET')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/advance-payments/ap-1', 'GET')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/advance-payments/ap-1/approve', 'POST')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/advance-payments/ap-1/approve', 'PATCH')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/advance-payments/ap-1/reject', 'POST')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/advance-payments/ap-1/screenshot', 'GET')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/advance-payments/ap-1/receipt/pdf', 'GET')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/advance-payments/ap-1/delete', 'DELETE')).toBe(false);
    });

    it('allows aggregation admin operations', () => {
      expect(isAllowedAdminProxyRoute('admin/aggregation/pools', 'GET')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/aggregation/pools/pool-1/finalize', 'POST')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/aggregation/pools/pool-1/cancel', 'POST')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/aggregation/pools', 'POST')).toBe(false);
    });

    it('allows catalog CRUD operations', () => {
      expect(isAllowedAdminProxyRoute('admin/catalog/category', 'GET')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/catalog/category', 'POST')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/catalog/category/cat-1', 'PATCH')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/catalog/category/cat-1', 'DELETE')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/catalog/products/prod-1', 'PATCH')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/catalog/invalid-tab', 'GET')).toBe(false);
    });

    it('allows payments, disputes, KYC, and supplier invoices operations', () => {
      expect(isAllowedAdminProxyRoute('admin/payments', 'GET')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/payments/pending', 'GET')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/payments/ord-1/approve', 'POST')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/payments/ord-1/reject', 'POST')).toBe(true);

      expect(isAllowedAdminProxyRoute('admin/disputes', 'GET')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/disputes/disp-1/resolve', 'POST')).toBe(true);

      expect(isAllowedAdminProxyRoute('admin/kyc', 'GET')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/kyc/kyc-1/approve', 'POST')).toBe(true);

      expect(isAllowedAdminProxyRoute('admin/supplier-invoices', 'GET')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/supplier-invoices/inv-1/confirm', 'POST')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/supplier-invoices/inv-1/payments', 'POST')).toBe(true);
    });

    it('allows pricing administration operations', () => {
      expect(isAllowedAdminProxyRoute('admin/pricing/anomalies', 'GET')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/pricing/anomalies/bulk-resolve', 'POST')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/pricing/rollups/daily/preview', 'POST')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/pricing/scheduler/run', 'POST')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/pricing/sources', 'GET')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/pricing/endpoints/ep-1/retry', 'POST')).toBe(true);
      expect(isAllowedAdminProxyRoute('admin/pricing/sku/unmapped', 'GET')).toBe(true);
    });

    it('strictly forbids builder and supplier operations through admin proxy', () => {
      expect(isAllowedAdminProxyRoute('builder/cart', 'GET')).toBe(false);
      expect(isAllowedAdminProxyRoute('builder/orders', 'POST')).toBe(false);
      expect(isAllowedAdminProxyRoute('supplier/listings', 'GET')).toBe(false);
      expect(isAllowedAdminProxyRoute('random/admin/route', 'GET')).toBe(false);
    });
  });

  describe('Admin Service Authentication & Assertion', () => {
    beforeEach(() => {
      process.env.ADMIN_SERVICE_SECRET = 'test-admin-secret';
      process.env.IDENTITY_ASSERTION_SECRET = 'test-assertion-secret';
    });

    it('generates service headers with X-Service-Name: admin', () => {
      const headers = getAdminServiceHeaders();
      expect(headers['X-Service-Name']).toBe('admin');
      expect(headers['X-Service-Key']).toBe('test-admin-secret');
    });

    it('generates valid HMAC assertion for ADMIN and SUPER_ADMIN roles', () => {
      const adminUser = {
        id: 'admin-1',
        email: 'ops@buildohub.in',
        name: 'Ops Admin',
        role: 'ADMIN',
      };
      const headers = getAdminServiceHeaders(adminUser);
      expect(headers['X-User-Assertion']).toBeDefined();

      const parts = headers['X-User-Assertion'].split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      expect(payload.sub).toBe('admin-1');
      expect(payload.email).toBe('ops@buildohub.in');
      expect(payload.role).toBe('ADMIN');
      expect(payload.iss).toBe('matsrc-admin');
      expect(payload.aud).toBe('matsrc-api');
    });
  });
});

