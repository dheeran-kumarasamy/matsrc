import { describe, it, expect, beforeEach } from 'vitest';
import { isAllowedRoute, containsPathTraversal } from './buyer-proxy';
import {
  getBuyerServiceHeaders,
  signBuyerUserAssertion,
  DEV_BUYER_SERVICE_SECRET,
  DEV_ASSERTION_SECRET,
} from './service-auth';
import * as crypto from 'crypto';

describe('Buyer Proxy Route Allowlist & Security Controls', () => {
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

    it('rejects traversal attempts in isAllowedRoute', () => {
      expect(isAllowedRoute('public/catalog/../admin', 'GET')).toBe(false);
      expect(isAllowedRoute('public/%2e%2e/admin', 'GET')).toBe(false);
      expect(isAllowedRoute('public/%252e%252e/admin', 'GET')).toBe(false);
    });
  });

  describe('isAllowedRoute Exact Matching', () => {
    it('allows valid public catalog GET requests', () => {
      expect(isAllowedRoute('public/catalog/category', 'GET')).toBe(true);
      expect(isAllowedRoute('public/catalog/brand', 'GET')).toBe(true);
      expect(isAllowedRoute('public/catalog/grade', 'GET')).toBe(true);
      expect(isAllowedRoute('public/catalog/unit', 'GET')).toBe(true);
    });

    it('rejects unsupported catalog entities or non-GET methods', () => {
      expect(isAllowedRoute('public/catalog/unknown', 'GET')).toBe(false);
      expect(isAllowedRoute('public/catalog/category', 'POST')).toBe(false);
      expect(isAllowedRoute('public/catalog/category', 'DELETE')).toBe(false);
    });

    it('allows public ticker, listings, and interest-event routes', () => {
      expect(isAllowedRoute('public/ticker', 'GET')).toBe(true);
      expect(isAllowedRoute('public/listings', 'GET')).toBe(true);
      expect(isAllowedRoute('public/listings/listing-123/interest-event', 'POST')).toBe(true);
      expect(isAllowedRoute('public/suppliers/sup-456/ratings/summary', 'GET')).toBe(true);
      expect(isAllowedRoute('public/listings/listing-789/anchoring', 'GET')).toBe(true);
    });

    it('allows exact builder aggregation routes and rejects wildcards', () => {
      // 4 allowed aggregation routes
      expect(isAllowedRoute('builder/aggregation/my-pools', 'GET')).toBe(true);
      expect(isAllowedRoute('builder/aggregation/pools/pool-123', 'GET')).toBe(true);
      expect(isAllowedRoute('builder/aggregation/opt-in', 'POST')).toBe(true);
      expect(isAllowedRoute('builder/aggregation/pools/pool-123/opt-out', 'POST')).toBe(true);

      // Disallowed methods or wildcards
      expect(isAllowedRoute('builder/aggregation/my-pools', 'POST')).toBe(false);
      expect(isAllowedRoute('builder/aggregation/pools/pool-123', 'DELETE')).toBe(false);
      expect(isAllowedRoute('builder/aggregation/orders/ord-1/save', 'POST')).toBe(false);
      expect(isAllowedRoute('builder/aggregation/arbitrary/wildcard', 'GET')).toBe(false);
    });

    it('strictly forbids admin and supplier routes through the buyer proxy', () => {
      expect(isAllowedRoute('admin/dashboard', 'GET')).toBe(false);
      expect(isAllowedRoute('admin/payments', 'POST')).toBe(false);
      expect(isAllowedRoute('admin/catalog/category', 'POST')).toBe(false);
      expect(isAllowedRoute('supplier/listings', 'GET')).toBe(false);
      expect(isAllowedRoute('supplier/orders', 'GET')).toBe(false);
      expect(isAllowedRoute('random/untrusted/path', 'GET')).toBe(false);
    });
  });

  describe('Service Authentication & Assertion Generation', () => {
    beforeEach(() => {
      process.env.BUYER_SERVICE_SECRET = 'test-buyer-secret';
      process.env.IDENTITY_ASSERTION_SECRET = 'test-assertion-secret';
    });

    it('generates service headers with X-Service-Name and X-Service-Key', () => {
      const headers = getBuyerServiceHeaders();
      expect(headers['X-Service-Name']).toBe('buyer');
      expect(headers['X-Service-Key']).toBe('test-buyer-secret');
      expect(headers['X-User-Assertion']).toBeUndefined();
    });

    it('attaches signed X-User-Assertion when user identity is present', () => {
      const user = {
        id: 'usr-builder-1',
        email: 'builder@example.com',
        name: 'Jane Builder',
        role: 'BUILDER',
      };
      const headers = getBuyerServiceHeaders(user);
      expect(headers['X-Service-Name']).toBe('buyer');
      expect(headers['X-Service-Key']).toBe('test-buyer-secret');
      expect(headers['X-User-Assertion']).toBeDefined();

      const parts = headers['X-User-Assertion'].split('.');
      expect(parts.length).toBe(3);

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      expect(payload.sub).toBe('usr-builder-1');
      expect(payload.email).toBe('builder@example.com');
      expect(payload.role).toBe('BUILDER');
      expect(payload.iss).toBe('matsrc-buyer');
      expect(payload.aud).toBe('matsrc-api');
    });

    it('verifies signature mathematically using HMAC-SHA256 with assertion secret', () => {
      const user = {
        id: 'usr-builder-1',
        email: 'builder@example.com',
      };
      const token = signBuyerUserAssertion(user, { secret: 'test-assertion-secret' });
      const [headerB64, payloadB64, signature] = token.split('.');
      const expectedSignature = crypto
        .createHmac('sha256', 'test-assertion-secret')
        .update(`${headerB64}.${payloadB64}`)
        .digest('base64url');

      expect(signature).toBe(expectedSignature);
    });
  });
});
