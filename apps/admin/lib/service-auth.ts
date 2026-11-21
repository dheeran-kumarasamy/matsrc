import * as crypto from 'crypto';

export interface ServiceUserIdentity {
  id?: string;
  email?: string | null;
  name?: string | null;
  role?: string;
  phone?: string | null;
}

export const DEV_ADMIN_SERVICE_SECRET = 'matsrc-admin-dev-secret';
export const DEV_ADMIN_ASSERTION_SECRET = 'matsrc-admin-assertion-dev-secret';
export const DEV_ASSERTION_SECRET = DEV_ADMIN_ASSERTION_SECRET;

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

export function getAdminServiceSecret(): string {
  const secret = process.env.ADMIN_SERVICE_SECRET;
  if (!secret) {
    return DEV_ADMIN_SERVICE_SECRET;
  }
  return secret;
}

export function getAdminAssertionSecret(): string {
  const secret = process.env.ADMIN_ASSERTION_SECRET || process.env.IDENTITY_ASSERTION_SECRET;

  if (!secret) {
    return DEV_ADMIN_ASSERTION_SECRET;
  }
  return secret;
}

export function signAdminUserAssertion(
  user: ServiceUserIdentity,
  options?: { expiresInSeconds?: number; secret?: string }
): string {
  const secret = options?.secret || getAdminAssertionSecret();
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = options?.expiresInSeconds ?? 300; // 5 minutes

  const userId = user.id || user.email;
  if (!userId || !user.email) {
    throw new Error('User identity must have id and email to create an assertion');
  }

  const role = user.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN';

  const payload = {
    sub: userId,
    email: user.email,
    name: user.name ?? undefined,
    phone: user.phone ?? undefined,
    role,
    iss: 'matsrc-admin',
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

export function getAdminServiceHeaders(
  user?: ServiceUserIdentity | null,
  options?: { extraHeaders?: HeadersInit }
): Record<string, string> {
  const serviceKey = getAdminServiceSecret();
  const headers: Record<string, string> = {
    'X-Service-Name': 'admin',
    'X-Service-Key': serviceKey,
  };

  if (user && user.email) {
    headers['X-User-Assertion'] = signAdminUserAssertion(user);
  }

  return headers;
}

export function getAdminServerHeaders(
  user: ServiceUserIdentity
): Record<string, string> {
  const serviceHeaders = getAdminServiceHeaders(user);
  return {
    ...serviceHeaders,
    'X-User-Id': user.id || user.email || 'Admin',
    'X-User-Email': user.email || 'admin@matsrc.in',
    'X-User-Name': user.name || 'Admin',
    'X-User-Role': user.role || 'ADMIN',
  };
}
