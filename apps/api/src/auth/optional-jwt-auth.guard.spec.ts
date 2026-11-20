import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';
import {
  signServiceAssertion,
  getJwtSecret,
  getAssertionSecret,
  getServiceSecret,
  ServiceName,
} from './service-auth.util';
import * as crypto from 'crypto';

function createMockContext(headers: Record<string, string>): any {
  const request: any = {
    headers: { ...headers },
    user: undefined,
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    request,
  };
}

function signTestJwt(payload: any, secret: string = getJwtSecret()): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const b64 = (s: string) => Buffer.from(s).toString('base64url');
  const head = b64(JSON.stringify(header));
  const pay = b64(JSON.stringify(payload));
  const data = `${head}.${pay}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

describe('OptionalJwtAuthGuard Security Hardening & Isolation', () => {
  let guard: OptionalJwtAuthGuard;
  const originalEnv = process.env;

  beforeEach(() => {
    guard = new OptionalJwtAuthGuard();
    process.env = { ...originalEnv };
    process.env.BUYER_SERVICE_SECRET = 'buyer-test-secret';
    process.env.SUPPLIER_SERVICE_SECRET = 'supplier-test-secret';
    process.env.ADMIN_SERVICE_SECRET = 'admin-test-secret';
    process.env.BUYER_ASSERTION_SECRET = 'buyer-assertion-secret';
    process.env.SUPPLIER_ASSERTION_SECRET = 'supplier-assertion-secret';
    process.env.ADMIN_ASSERTION_SECRET = 'admin-assertion-secret';
    process.env.IDENTITY_ASSERTION_SECRET = 'buyer-assertion-secret';
    process.env.NEXTAUTH_SECRET = 'jwt-test-secret';
  });

  // Scenario 1: Direct API call with spoofed X-User-Id / X-User-Role: ADMIN (no service headers)
  it('1. Rejects spoofed X-User-Id and X-User-Role headers without service auth (401)', async () => {
    const { request, ...ctx } = createMockContext({
      'x-user-id': 'admin-attacker',
      'x-user-email': 'attacker@evil.com',
      'x-user-role': 'ADMIN',
    });

    await expect(guard.canActivate(ctx as any)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx as any)).rejects.toThrow(
      'Direct unauthenticated user identity headers are not permitted'
    );
    expect(request.user).toBeUndefined();
  });

  // Scenario 2: Direct API call with invalid Bearer token
  it('2. Rejects invalid Bearer token format or invalid signature (401)', async () => {
    const ctx = createMockContext({
      authorization: 'Bearer invalid.token.signature',
    });

    await expect(guard.canActivate(ctx as any)).rejects.toThrow(UnauthorizedException);
  });

  // Scenario 3: Expired Bearer token
  it('3. Rejects expired Bearer token (401)', async () => {
    const expiredPayload = {
      sub: 'builder-123',
      email: 'builder@example.com',
      role: 'BUILDER',
      exp: Math.floor(Date.now() / 1000) - 120, // Expired 2 minutes ago
    };
    const expiredToken = signTestJwt(expiredPayload, process.env.NEXTAUTH_SECRET);
    const ctx = createMockContext({
      authorization: `Bearer ${expiredToken}`,
    });

    await expect(guard.canActivate(ctx as any)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx as any)).rejects.toThrow('JWT token expired');
  });

  // Scenario 4: Valid Bearer token
  it('4. Accepts valid Bearer token and sets request.user (200/true)', async () => {
    const validPayload = {
      sub: 'builder-123',
      email: 'builder@example.com',
      role: 'BUILDER',
      name: 'Test Builder',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const validToken = signTestJwt(validPayload, process.env.NEXTAUTH_SECRET);
    const { request, ...ctx } = createMockContext({
      authorization: `Bearer ${validToken}`,
    });

    const result = await guard.canActivate(ctx as any);
    expect(result).toBe(true);
    expect(request.user).toEqual({
      userId: 'builder-123',
      email: 'builder@example.com',
      role: 'BUILDER',
      name: 'Test Builder',
      phone: undefined,
    });
  });

  // Scenario 5: Service call with missing X-Service-Name or X-Service-Key
  it('5. Rejects incomplete service headers (missing X-Service-Key or X-User-Assertion) (401)', async () => {
    const ctx1 = createMockContext({
      'x-service-name': 'buyer',
    });
    await expect(guard.canActivate(ctx1 as any)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx1 as any)).rejects.toThrow('Incomplete service authentication headers');

    const ctx2 = createMockContext({
      'x-service-name': 'buyer',
      'x-service-key': 'buyer-test-secret',
    });
    await expect(guard.canActivate(ctx2 as any)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx2 as any)).rejects.toThrow('Incomplete service authentication headers');
  });

  // Scenario 6: Service call with invalid X-Service-Key
  it('6. Rejects service call with invalid X-Service-Key (401)', async () => {
    const assertion = signServiceAssertion(
      { sub: 'builder-1', email: 'b@matsrc.in', role: 'BUILDER' },
      'buyer'
    );
    const ctx = createMockContext({
      'x-service-name': 'buyer',
      'x-service-key': 'wrong-secret',
      'x-user-assertion': assertion,
    });

    await expect(guard.canActivate(ctx as any)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx as any)).rejects.toThrow('Invalid service credential');
  });

  // Scenario 7: Cross-service credential mismatch (calling admin with Buyer's secret)
  it('7. Rejects cross-service credential confusion (e.g. calling admin with Buyer secret) (401)', async () => {
    const assertion = signServiceAssertion(
      { sub: 'admin-1', email: 'admin@matsrc.in', role: 'ADMIN' },
      'admin'
    );
    const ctx = createMockContext({
      'x-service-name': 'admin',
      'x-service-key': 'buyer-test-secret', // Buyer's key presented for Admin!
      'x-user-assertion': assertion,
    });

    await expect(guard.canActivate(ctx as any)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx as any)).rejects.toThrow('Invalid service credential');
  });

  // Scenario 8: Shared-secret fallback elimination (INTERNAL_SERVICE_SECRET is NOT used)
  it('8. Confirms distinct service secrets are strictly enforced and shared fallback is absent', () => {
    delete process.env.BUYER_SERVICE_SECRET;
    delete process.env.INTERNAL_SERVICE_SECRET;
    process.env.NODE_ENV = 'production';

    // In production without BUYER_SERVICE_SECRET configured, must fail
    expect(() => getServiceSecret('buyer')).toThrow(UnauthorizedException);
    expect(() => getServiceSecret('buyer')).toThrow('Service secret not configured for buyer');
  });

  // Scenario 9: Service call with invalid or tampered X-User-Assertion signature
  it('9. Rejects tampered X-User-Assertion signature (401)', async () => {
    const assertion = signServiceAssertion(
      { sub: 'builder-1', email: 'b@matsrc.in', role: 'BUILDER' },
      'buyer',
      { secret: 'wrong-key-used-for-signing' }
    );
    const ctx = createMockContext({
      'x-service-name': 'buyer',
      'x-service-key': 'buyer-test-secret',
      'x-user-assertion': assertion,
    });

    await expect(guard.canActivate(ctx as any)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx as any)).rejects.toThrow('Invalid assertion signature');
  });

  // Scenario 10: Service call with expired X-User-Assertion
  it('10. Rejects expired X-User-Assertion (401)', async () => {
    const expiredAssertion = signServiceAssertion(
      { sub: 'builder-1', email: 'b@matsrc.in', role: 'BUILDER' },
      'buyer',
      { expiresInSeconds: -120 }
    );
    const ctx = createMockContext({
      'x-service-name': 'buyer',
      'x-service-key': 'buyer-test-secret',
      'x-user-assertion': expiredAssertion,
    });

    await expect(guard.canActivate(ctx as any)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx as any)).rejects.toThrow('User assertion token expired');
  });

  // Scenario 11: Buyer service asserting role ADMIN or SUPPLIER (403)
  it('11. Rejects Buyer service attempting to assert ADMIN or SUPPLIER role (403 Forbidden)', async () => {
    const spoofedAdmin = signServiceAssertion(
      { sub: 'attacker-1', email: 'attacker@evil.com', role: 'ADMIN' },
      'buyer'
    );
    const ctxAdmin = createMockContext({
      'x-service-name': 'buyer',
      'x-service-key': 'buyer-test-secret',
      'x-user-assertion': spoofedAdmin,
    });

    await expect(guard.canActivate(ctxAdmin as any)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctxAdmin as any)).rejects.toThrow("Service 'buyer' is not authorized to assert role 'ADMIN'");

    const spoofedSupplier = signServiceAssertion(
      { sub: 'attacker-1', email: 'attacker@evil.com', role: 'SUPPLIER' },
      'buyer'
    );
    const ctxSupplier = createMockContext({
      'x-service-name': 'buyer',
      'x-service-key': 'buyer-test-secret',
      'x-user-assertion': spoofedSupplier,
    });

    await expect(guard.canActivate(ctxSupplier as any)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctxSupplier as any)).rejects.toThrow("Service 'buyer' is not authorized to assert role 'SUPPLIER'");
  });

  // Scenario 12: Supplier service asserting role ADMIN or BUILDER (403)
  it('12. Rejects Supplier service attempting to assert ADMIN or BUILDER role (403 Forbidden)', async () => {
    const spoofedAdmin = signServiceAssertion(
      { sub: 'supplier-1', email: 's@evil.com', role: 'ADMIN' },
      'supplier'
    );
    const ctxAdmin = createMockContext({
      'x-service-name': 'supplier',
      'x-service-key': 'supplier-test-secret',
      'x-user-assertion': spoofedAdmin,
    });

    await expect(guard.canActivate(ctxAdmin as any)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctxAdmin as any)).rejects.toThrow("Service 'supplier' is not authorized to assert role 'ADMIN'");

    const spoofedBuilder = signServiceAssertion(
      { sub: 'supplier-1', email: 's@evil.com', role: 'BUILDER' },
      'supplier'
    );
    const ctxBuilder = createMockContext({
      'x-service-name': 'supplier',
      'x-service-key': 'supplier-test-secret',
      'x-user-assertion': spoofedBuilder,
    });

    await expect(guard.canActivate(ctxBuilder as any)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctxBuilder as any)).rejects.toThrow("Service 'supplier' is not authorized to assert role 'BUILDER'");
  });

  // Scenario 13: Admin service attempting to assert role BUILDER or SUPPLIER (403)
  it('13. Rejects Admin service attempting to assert BUILDER or SUPPLIER role (403 Forbidden)', async () => {
    const spoofedBuilder = signServiceAssertion(
      { sub: 'admin-1', email: 'admin@matsrc.in', role: 'BUILDER' },
      'admin'
    );
    const ctxBuilder = createMockContext({
      'x-service-name': 'admin',
      'x-service-key': 'admin-test-secret',
      'x-user-assertion': spoofedBuilder,
    });

    await expect(guard.canActivate(ctxBuilder as any)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctxBuilder as any)).rejects.toThrow("Service 'admin' is not authorized to assert role 'BUILDER'");
  });

  // Scenario 14: Positive verification: Valid Buyer assertion
  it('14. Successfully authenticates valid Buyer service asserting BUILDER', async () => {
    const assertion = signServiceAssertion(
      { sub: 'buyer-42', email: 'buyer@matsrc.in', role: 'BUILDER', name: 'Buyer 42' },
      'buyer'
    );
    const { request, ...ctx } = createMockContext({
      'x-service-name': 'buyer',
      'x-service-key': 'buyer-test-secret',
      'x-user-assertion': assertion,
    });

    expect(await guard.canActivate(ctx as any)).toBe(true);
    expect(request.user).toEqual({
      userId: 'buyer-42',
      email: 'buyer@matsrc.in',
      role: 'BUILDER',
      name: 'Buyer 42',
      phone: undefined,
    });
  });

  // Scenario 15: Positive verification: Valid Supplier assertion
  it('15. Successfully authenticates valid Supplier service asserting SUPPLIER', async () => {
    const assertion = signServiceAssertion(
      { sub: 'sup-1', email: 'supplier@matsrc.in', role: 'SUPPLIER', name: 'Supplier Steel' },
      'supplier'
    );
    const { request, ...ctx } = createMockContext({
      'x-service-name': 'supplier',
      'x-service-key': 'supplier-test-secret',
      'x-user-assertion': assertion,
    });

    expect(await guard.canActivate(ctx as any)).toBe(true);
    expect(request.user).toEqual({
      userId: 'sup-1',
      email: 'supplier@matsrc.in',
      role: 'SUPPLIER',
      name: 'Supplier Steel',
      phone: undefined,
    });
  });

  // Scenario 16: Positive verification: Valid Admin assertion
  it('16. Successfully authenticates valid Admin service asserting ADMIN and SUPER_ADMIN', async () => {
    const assertionAdmin = signServiceAssertion(
      { sub: 'admin-1', email: 'admin@matsrc.in', role: 'ADMIN', name: 'Ops Admin' },
      'admin'
    );
    const { request: req1, ...ctxAdmin } = createMockContext({
      'x-service-name': 'admin',
      'x-service-key': 'admin-test-secret',
      'x-user-assertion': assertionAdmin,
    });

    expect(await guard.canActivate(ctxAdmin as any)).toBe(true);
    expect(req1.user.role).toBe('ADMIN');

    const assertionSuper = signServiceAssertion(
      { sub: 'super-1', email: 'super@matsrc.in', role: 'SUPER_ADMIN', name: 'Root' },
      'admin'
    );
    const { request: req2, ...ctxSuper } = createMockContext({
      'x-service-name': 'admin',
      'x-service-key': 'admin-test-secret',
      'x-user-assertion': assertionSuper,
    });

    expect(await guard.canActivate(ctxSuper as any)).toBe(true);
    expect(req2.user.role).toBe('SUPER_ADMIN');
  });

  // Scenario 17: Request with no credentials whatsoever (401)
  it('17. Rejects request with no credentials whatsoever (401)', async () => {
    const ctx = createMockContext({});
    await expect(guard.canActivate(ctx as any)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx as any)).rejects.toThrow('No authentication provided');
  });

  // Scenario 18: Rejects invalid issuer
  it('18. Rejects assertion with mismatched/invalid issuer (401)', async () => {
    // Manually craft a token signed with supplier's key but claiming an invalid issuer
    const now = Math.floor(Date.now() / 1000);
    const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payloadB64 = Buffer.from(
      JSON.stringify({
        sub: 'buyer-1',
        email: 'b@matsrc.in',
        role: 'SUPPLIER',
        iss: 'matsrc-invalid-issuer',
        aud: 'matsrc-api',
        iat: now,
        exp: now + 300,
      })
    ).toString('base64url');
    const data = `${headerB64}.${payloadB64}`;
    const sig = crypto
      .createHmac('sha256', process.env.SUPPLIER_ASSERTION_SECRET!)
      .update(data)
      .digest('base64url');
    const assertion = `${data}.${sig}`;

    const ctx = createMockContext({
      'x-service-name': 'supplier',
      'x-service-key': 'supplier-test-secret',
      'x-user-assertion': assertion,
    });

    await expect(guard.canActivate(ctx as any)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx as any)).rejects.toThrow('Invalid assertion issuer');
  });

  // Scenario 19: Database user lookup — user does not exist in DB (401)
  it('19. Rejects assertion with arbitrary Builder ID when user does not exist in database (401)', async () => {
    const mockPrisma: any = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const dbGuard = new OptionalJwtAuthGuard(mockPrisma);

    const assertion = signServiceAssertion(
      { sub: 'arbitrary-builder-999', email: 'arbitrary@example.com', role: 'BUILDER' },
      'buyer'
    );
    const ctx = createMockContext({
      'x-service-name': 'buyer',
      'x-service-key': 'buyer-test-secret',
      'x-user-assertion': assertion,
    });

    await expect(dbGuard.canActivate(ctx as any)).rejects.toThrow(UnauthorizedException);
    await expect(dbGuard.canActivate(ctx as any)).rejects.toThrow('User identity not found in database');
  });

  // Scenario 20: Database role mismatch — DB user has role SUPPLIER, assertion claims BUILDER (403)
  it('20. Rejects assertion when database role conflicts with asserted role (403)', async () => {
    const mockPrisma: any = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-123',
          email: 'supplier@matsrc.in',
          role: 'SUPPLIER', // DB has SUPPLIER
          name: 'Real Supplier',
        }),
      },
    };
    const dbGuard = new OptionalJwtAuthGuard(mockPrisma);

    const assertion = signServiceAssertion(
      { sub: 'user-123', email: 'supplier@matsrc.in', role: 'BUILDER' }, // Claims BUILDER
      'buyer'
    );
    const ctx = createMockContext({
      'x-service-name': 'buyer',
      'x-service-key': 'buyer-test-secret',
      'x-user-assertion': assertion,
    });

    await expect(dbGuard.canActivate(ctx as any)).rejects.toThrow(ForbiddenException);
    await expect(dbGuard.canActivate(ctx as any)).rejects.toThrow('Database role mismatch');
  });

  // Scenario 21: Database email mismatch (401)
  it('21. Rejects assertion when user email does not match database record (401)', async () => {
    const mockPrisma: any = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-123',
          email: 'actual-owner@matsrc.in',
          role: 'BUILDER',
        }),
      },
    };
    const dbGuard = new OptionalJwtAuthGuard(mockPrisma);

    const assertion = signServiceAssertion(
      { sub: 'user-123', email: 'impostor@matsrc.in', role: 'BUILDER' },
      'buyer'
    );
    const ctx = createMockContext({
      'x-service-name': 'buyer',
      'x-service-key': 'buyer-test-secret',
      'x-user-assertion': assertion,
    });

    await expect(dbGuard.canActivate(ctx as any)).rejects.toThrow(UnauthorizedException);
    await expect(dbGuard.canActivate(ctx as any)).rejects.toThrow('User identity mismatch between assertion and database');
  });

  // Scenario 22: Successful DB verification populates request.user from authoritative DB record
  it('22. Successfully binds assertion to verified database user record', async () => {
    const mockPrisma: any = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'builder-verified',
          email: 'builder@matsrc.in',
          role: 'BUILDER',
          name: 'Authoritative Name From DB',
          phone: '+919876543210',
        }),
      },
    };
    const dbGuard = new OptionalJwtAuthGuard(mockPrisma);

    const assertion = signServiceAssertion(
      { sub: 'builder-verified', email: 'builder@matsrc.in', role: 'BUILDER' },
      'buyer'
    );
    const { request, ...ctx } = createMockContext({
      'x-service-name': 'buyer',
      'x-service-key': 'buyer-test-secret',
      'x-user-assertion': assertion,
    });

    expect(await dbGuard.canActivate(ctx as any)).toBe(true);
    expect(request.user).toEqual({
      userId: 'builder-verified',
      email: 'builder@matsrc.in',
      role: 'BUILDER',
      name: 'Authoritative Name From DB',
      phone: '+919876543210',
    });
  });

  // Scenario 23: Separate per-service assertion secrets: cross-service assertion signature fails
  it('23. Enforces per-service assertion secrets: buyer assertion rejected under supplier secret (401)', async () => {
    process.env.BUYER_ASSERTION_SECRET = 'secret-buyer-key-111';
    process.env.SUPPLIER_ASSERTION_SECRET = 'secret-supplier-key-222';

    // Sign using buyer secret
    const buyerAssertion = signServiceAssertion(
      { sub: 'user-1', email: 'b@matsrc.in', role: 'BUILDER' },
      'buyer'
    );

    // Verify under supplier service name (which uses SUPPLIER_ASSERTION_SECRET)
    const ctx = createMockContext({
      'x-service-name': 'supplier',
      'x-service-key': 'supplier-test-secret',
      'x-user-assertion': buyerAssertion,
    });

    await expect(guard.canActivate(ctx as any)).rejects.toThrow(UnauthorizedException);
  });

  // Scenario 24: Impersonation attempt of another existing account with same role
  it('24. Rejects impersonation of another existing user with same role (sub/email mismatch) (401)', async () => {
    const mockPrisma: any = {
      user: {
        findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
          if (where.id === 'builder-bob') {
            return {
              id: 'builder-bob',
              email: 'bob@builder.in',
              role: 'BUILDER',
              name: 'Bob Builder',
            };
          }
          return null;
        }),
      },
    };
    const dbGuard = new OptionalJwtAuthGuard(mockPrisma);

    // Attacker crafts assertion claiming Bob's ID with Alice's email
    const maliciousAssertion = signServiceAssertion(
      { sub: 'builder-bob', email: 'alice@builder.in', role: 'BUILDER' },
      'buyer'
    );
    const ctx = createMockContext({
      'x-service-name': 'buyer',
      'x-service-key': 'buyer-test-secret',
      'x-user-assertion': maliciousAssertion,
    });

    await expect(dbGuard.canActivate(ctx as any)).rejects.toThrow(UnauthorizedException);
    await expect(dbGuard.canActivate(ctx as any)).rejects.toThrow(
      'User identity mismatch between assertion and database'
    );
  });

  // Scenario 25: Disabled / KYC-rejected account is strictly rejected
  it('25. Rejects assertion for inactive/disabled account with KYC rejected (403)', async () => {
    const mockPrisma: any = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'builder-eve',
          email: 'eve@builder.in',
          role: 'BUILDER',
          name: 'Eve Suspended',
          kycStatus: 'REJECTED',
        }),
      },
    };
    const dbGuard = new OptionalJwtAuthGuard(mockPrisma);

    const assertion = signServiceAssertion(
      { sub: 'builder-eve', email: 'eve@builder.in', role: 'BUILDER' },
      'buyer'
    );
    const ctx = createMockContext({
      'x-service-name': 'buyer',
      'x-service-key': 'buyer-test-secret',
      'x-user-assertion': assertion,
    });

    await expect(dbGuard.canActivate(ctx as any)).rejects.toThrow(ForbiddenException);
    await expect(dbGuard.canActivate(ctx as any)).rejects.toThrow('Account is disabled or KYC rejected');
  });

  // Scenario 26: Cross-portal assertion secret: supplier secret cannot sign for buyer
  it('26. Rejects assertion signed with supplier secret when presented under buyer service (401)', async () => {
    process.env.BUYER_ASSERTION_SECRET = 'secret-buyer-key-111';
    process.env.SUPPLIER_ASSERTION_SECRET = 'secret-supplier-key-222';

    // Sign using supplier secret
    const supplierAssertion = signServiceAssertion(
      { sub: 'sup-1', email: 'sup@matsrc.in', role: 'SUPPLIER' },
      'supplier'
    );

    // Present to buyer service
    const ctx = createMockContext({
      'x-service-name': 'buyer',
      'x-service-key': 'buyer-test-secret',
      'x-user-assertion': supplierAssertion,
    });

    await expect(guard.canActivate(ctx as any)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx as any)).rejects.toThrow('Invalid assertion signature');
  });
});
