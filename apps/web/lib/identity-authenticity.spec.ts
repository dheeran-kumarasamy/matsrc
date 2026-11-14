import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveUserCtx } from './builder-db';

// Mock auth from NextAuth
vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import { auth } from '@/auth';

describe('Gate A: End-to-End User Identity Authenticity & Impersonation Prevention', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('resolveUserCtx anti-impersonation guards', () => {
    it('1. Rejects authenticated Builder attempting to supply another user ID/email via headers', async () => {
      // Alice is authenticated via NextAuth session
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: 'builder-alice-id',
          email: 'alice@builder.in',
          name: 'Alice Builder',
        },
      } as any);

      // Alice tampers with request headers to claim Bob's identity
      const request = new Request('https://matsrc.in/api/builder/cart', {
        headers: {
          'X-User-Id': 'builder-bob-id',
          'X-User-Email': 'bob@builder.in',
        },
      });

      await expect(resolveUserCtx(request)).rejects.toThrow('FORBIDDEN_IMPERSONATION');
    });

    it('2. Authoritatively derives identity from session when headers are absent', async () => {
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: 'builder-alice-id',
          email: 'alice@builder.in',
          name: 'Alice Builder',
        },
      } as any);

      const request = new Request('https://matsrc.in/api/builder/cart');
      const ctx = await resolveUserCtx(request);

      expect(ctx.userId).toBe('builder-alice-id');
      expect(ctx.email).toBe('alice@builder.in');
      expect(ctx.name).toBe('Alice Builder');
    });

    it('3. Rejects unauthenticated caller when session is null and no headers exist', async () => {
      vi.mocked(auth).mockResolvedValue(null as any);

      const request = new Request('https://matsrc.in/api/builder/cart');
      await expect(resolveUserCtx(request)).rejects.toThrow('UNAUTHENTICATED');
    });

    it('4. Rejects unauthenticated caller even when forged identity headers are supplied', async () => {
      vi.mocked(auth).mockResolvedValue(null as any);

      const request = new Request('https://matsrc.in/api/builder/cart', {
        headers: {
          'X-User-Id': 'builder-victim-id',
          'X-User-Email': 'victim@builder.in',
        },
      });

      await expect(resolveUserCtx(request)).rejects.toThrow('UNAUTHENTICATED');
    });

    it('5. Rejects authenticated Builder with forged X-User-Id even if email header matches', async () => {
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: 'builder-alice-id',
          email: 'alice@builder.in',
          name: 'Alice Builder',
        },
      } as any);

      const request = new Request('https://matsrc.in/api/builder/cart', {
        headers: {
          'X-User-Id': 'attacker-forged-id',
          'X-User-Email': 'alice@builder.in',
        },
      });

      await expect(resolveUserCtx(request)).rejects.toThrow('FORBIDDEN_IMPERSONATION');
    });

    it('6. Accepts authenticated Builder when matching identity headers are supplied', async () => {
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: 'builder-alice-id',
          email: 'alice@builder.in',
          name: 'Alice Builder',
        },
      } as any);

      const request = new Request('https://matsrc.in/api/builder/cart', {
        headers: {
          'X-User-Id': 'builder-alice-id',
          'X-User-Email': 'alice@builder.in',
        },
      });

      const ctx = await resolveUserCtx(request);
      expect(ctx.userId).toBe('builder-alice-id');
      expect(ctx.email).toBe('alice@builder.in');
    });

    it('7. Handles case-insensitive email matching for legitimate requests', async () => {
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: 'builder-alice-id',
          email: 'Alice@Builder.IN',
          name: 'Alice Builder',
        },
      } as any);

      const request = new Request('https://matsrc.in/api/builder/cart', {
        headers: {
          'X-User-Email': 'alice@builder.in',
        },
      });

      const ctx = await resolveUserCtx(request);
      expect(ctx.email).toBe('Alice@Builder.IN');
    });
  });
});
