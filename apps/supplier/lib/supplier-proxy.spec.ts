import { describe, it, expect, beforeEach } from 'vitest';
import { isAllowedSupplierProxyRoute, containsPathTraversal } from './supplier-proxy';
import {
  getSupplierServiceHeaders,
  signSupplierUserAssertion,
  DEV_SUPPLIER_SERVICE_SECRET,
  DEV_ASSERTION_SECRET,
} from './service-auth';
import * as crypto from 'crypto';

describe('Supplier Proxy Route Allowlist & Security Controls', () => {
  describe('Path traversal defense', () => {
    it('detects directory traversal patterns including multi-encoded sequences', () => {
      expect(containsPathTraversal('public/../../admin')).toBe(true);
      expect(containsPathTraversal('public/%2e%2e/admin')).toBe(true);
      expect(containsPathTraversal('public/%252e%252e/admin')).toBe(true);
      expect(containsPathTraversal('public/%252e%252e')).toBe(true);
      expect(containsPathTraversal('public/..\\admin')).toBe(true);
      expect(containsPathTraversal('public%5cadmin')).toBe(true);
      expect(containsPathTraversal('public%2f%2e%2e')).toBe(true);
      expect(containsPathTraversal('public/catalog/./category')).toBe(true);
      expect(containsPathTraversal('public//ticker')).toBe(true);
      expect(containsPathTraversal('public/ticker\0extra')).toBe(true);
      expect(containsPathTraversal('public/ticker%00extra')).toBe(true);
      expect(containsPathTraversal('public/ticker%2500extra')).toBe(true);
      expect(containsPathTraversal('public/ticker')).toBe(false);
      expect(containsPathTraversal('public/catalog/category')).toBe(false);
    });

    it('rejects traversal attempts in isAllowedSupplierProxyRoute', () => {
      expect(isAllowedSupplierProxyRoute('public/catalog/../admin', 'GET')).toBe(false);
      expect(isAllowedSupplierProxyRoute('public/%2e%2e/admin', 'GET')).toBe(false);
      expect(isAllowedSupplierProxyRoute('public/%252e%252e/admin', 'GET')).toBe(false);
    });
  });

  describe('isAllowedSupplierProxyRoute Exact Matching', () => {
    it('allows public catalog master-data dropdowns', () => {
      expect(isAllowedSupplierProxyRoute('public/catalog/category', 'GET')).toBe(true);
      expect(isAllowedSupplierProxyRoute('public/catalog/brand', 'GET')).toBe(true);
      expect(isAllowedSupplierProxyRoute('public/catalog/grade', 'GET')).toBe(true);
      expect(isAllowedSupplierProxyRoute('public/catalog/unit', 'GET')).toBe(true);
    });

    it('rejects unsupported catalog entities or non-GET methods', () => {
      expect(isAllowedSupplierProxyRoute('public/catalog/invalid', 'GET')).toBe(false);
      expect(isAllowedSupplierProxyRoute('public/catalog/category', 'POST')).toBe(false);
    });

    it('allows public ticker and listings', () => {
      expect(isAllowedSupplierProxyRoute('public/ticker', 'GET')).toBe(true);
      expect(isAllowedSupplierProxyRoute('public/listings', 'GET')).toBe(true);
      expect(isAllowedSupplierProxyRoute('public/listings', 'POST')).toBe(false);
    });

    it('allows exact supplier aggregation routes and rejects wildcards', () => {
      expect(isAllowedSupplierProxyRoute('supplier/aggregation/pools', 'GET')).toBe(true);
      expect(isAllowedSupplierProxyRoute('supplier/aggregation/pools/pool-42/force-lock', 'POST')).toBe(true);

      // Disallowed methods or wildcards
      expect(isAllowedSupplierProxyRoute('supplier/aggregation/pools', 'POST')).toBe(false);
      expect(isAllowedSupplierProxyRoute('supplier/aggregation/pools/pool-42/force-lock', 'GET')).toBe(false);
      expect(isAllowedSupplierProxyRoute('supplier/listings', 'GET')).toBe(false);
      expect(isAllowedSupplierProxyRoute('supplier/listings', 'POST')).toBe(false);
      expect(isAllowedSupplierProxyRoute('supplier/orders/ord-1/status', 'PATCH')).toBe(false);
    });

    it('strictly forbids admin and builder routes through supplier proxy', () => {
      expect(isAllowedSupplierProxyRoute('admin/dashboard', 'GET')).toBe(false);
      expect(isAllowedSupplierProxyRoute('admin/payments', 'POST')).toBe(false);
      expect(isAllowedSupplierProxyRoute('builder/cart', 'GET')).toBe(false);
      expect(isAllowedSupplierProxyRoute('builder/orders', 'POST')).toBe(false);
    });
  });

  describe('Supplier Service Authentication & Assertion', () => {
    beforeEach(() => {
      process.env.SUPPLIER_SERVICE_SECRET = 'test-supplier-secret';
      process.env.IDENTITY_ASSERTION_SECRET = 'test-assertion-secret';
    });

    it('generates service headers with X-Service-Name: supplier', () => {
      const headers = getSupplierServiceHeaders();
      expect(headers['X-Service-Name']).toBe('supplier');
      expect(headers['X-Service-Key']).toBe('test-supplier-secret');
    });

    it('generates valid HMAC assertion for SUPPLIER role', () => {
      const user = {
        id: 'sup-user-1',
        email: 'supplier@metal.in',
        name: 'Steel Supplier',
      };
      const headers = getSupplierServiceHeaders(user);
      expect(headers['X-User-Assertion']).toBeDefined();

      const parts = headers['X-User-Assertion'].split('.');
      expect(parts.length).toBe(3);

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      expect(payload.sub).toBe('sup-user-1');
      expect(payload.email).toBe('supplier@metal.in');
      expect(payload.role).toBe('SUPPLIER');
      expect(payload.iss).toBe('matsrc-supplier');
      expect(payload.aud).toBe('matsrc-api');
    });
  });
});
