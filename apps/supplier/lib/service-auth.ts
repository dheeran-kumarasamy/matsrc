import * as crypto from 'crypto';

export interface ServiceUserIdentity {
  id?: string;
  email?: string | null;
  name?: string | null;
  role?: string;
  phone?: string | null;
}

export const DEV_SUPPLIER_SERVICE_SECRET = 'matsrc-supplier-dev-secret';
export const DEV_SUPPLIER_ASSERTION_SECRET = 'matsrc-supplier-assertion-dev-secret';
export const DEV_ASSERTION_SECRET = DEV_SUPPLIER_ASSERTION_SECRET;

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

export function getSupplierServiceSecret(): string {
  const secret = process.env.SUPPLIER_SERVICE_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL_ENV && !process.env.BUILDOHUB_ENV) {
      return DEV_SUPPLIER_SERVICE_SECRET;
    }
    throw new Error('SUPPLIER_SERVICE_SECRET is not configured');
  }
  return secret;
}

export function getSupplierAssertionSecret(): string {
  const secret = process.env.SUPPLIER_ASSERTION_SECRET || process.env.IDENTITY_ASSERTION_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL_ENV && !process.env.BUILDOHUB_ENV) {
      return DEV_SUPPLIER_ASSERTION_SECRET;
    }
    throw new Error('SUPPLIER_ASSERTION_SECRET is not configured');
  }
  return secret;
}

export function signSupplierUserAssertion(
  user: ServiceUserIdentity,
  options?: { expiresInSeconds?: number; secret?: string }
): string {
  const secret = options?.secret || getSupplierAssertionSecret();
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = options?.expiresInSeconds ?? 300; // 5 minutes

  const userId = user.id || user.email;
  if (!userId || !user.email) {
    throw new Error('User identity must have id and email to create an assertion');
  }

  // Supplier service can ONLY assert role SUPPLIER
  const payload = {
    sub: userId,
    email: user.email,
    name: user.name ?? undefined,
    phone: user.phone ?? undefined,
    role: 'SUPPLIER',
    iss: 'matsrc-supplier',
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

export function getSupplierServiceHeaders(
  user?: ServiceUserIdentity | null,
  options?: { extraHeaders?: HeadersInit }
): Record<string, string> {
  const serviceKey = getSupplierServiceSecret();
  const headers: Record<string, string> = {
    'X-Service-Name': 'supplier',
    'X-Service-Key': serviceKey,
  };

  if (user && user.email) {
    headers['X-User-Assertion'] = signSupplierUserAssertion(user);
  }

  return headers;
}
