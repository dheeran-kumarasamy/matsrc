import * as crypto from 'crypto';

export interface ServiceUserIdentity {
  id?: string;
  email?: string | null;
  name?: string | null;
  role?: string;
  phone?: string | null;
}

export const DEV_BUYER_SERVICE_SECRET = 'matsrc-buyer-dev-secret';
export const DEV_BUYER_ASSERTION_SECRET = 'matsrc-buyer-assertion-dev-secret';
export const DEV_ASSERTION_SECRET = DEV_BUYER_ASSERTION_SECRET;

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

export function getBuyerServiceSecret(): string {
  const secret = process.env.BUYER_SERVICE_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL_ENV && !process.env.BUILDOHUB_ENV) {
      return DEV_BUYER_SERVICE_SECRET;
    }
    throw new Error('BUYER_SERVICE_SECRET is not configured');
  }
  return secret;
}

export function getBuyerAssertionSecret(): string {
  const secret = process.env.BUYER_ASSERTION_SECRET || process.env.IDENTITY_ASSERTION_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL_ENV && !process.env.BUILDOHUB_ENV) {
      return DEV_BUYER_ASSERTION_SECRET;
    }
    throw new Error('BUYER_ASSERTION_SECRET is not configured');
  }
  return secret;
}

export function signBuyerUserAssertion(
  user: ServiceUserIdentity,
  options?: { expiresInSeconds?: number; secret?: string }
): string {
  const secret = options?.secret || getBuyerAssertionSecret();
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = options?.expiresInSeconds ?? 300; // 5 minutes

  const userId = user.id || user.email;
  if (!userId || !user.email) {
    throw new Error('User identity must have id and email to create an assertion');
  }

  // Buyer service can ONLY assert role BUILDER
  const payload = {
    sub: userId,
    email: user.email,
    name: user.name ?? undefined,
    phone: user.phone ?? undefined,
    role: 'BUILDER',
    iss: 'matsrc-buyer',
    aud: 'matsrc-api',
    iat: now,
    exp: now + expiresIn,
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const data = `${headerB64}.${payloadB64}`;
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64url');

  return `${data}.${signature}`;
}

export function getBuyerServiceHeaders(
  user?: ServiceUserIdentity | null,
  options?: { extraHeaders?: HeadersInit }
): Record<string, string> {
  const serviceKey = getBuyerServiceSecret();
  const headers: Record<string, string> = {
    'X-Service-Name': 'buyer',
    'X-Service-Key': serviceKey,
  };

  if (user && user.email) {
    headers['X-User-Assertion'] = signBuyerUserAssertion(user);
  }

  return headers;
}
