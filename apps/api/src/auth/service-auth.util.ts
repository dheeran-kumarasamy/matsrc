import * as crypto from 'crypto';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

export type ServiceName = 'buyer' | 'supplier' | 'admin';

export interface ServiceUserAssertion {
  sub: string;
  email: string;
  role: string;
  name?: string;
  phone?: string;
  iss?: string;
  aud?: string;
  exp?: number;
  iat?: number;
  jti?: string;
}

export const PERMITTED_SERVICE_ROLES: Record<ServiceName, string[]> = {
  buyer: ['BUILDER'],
  supplier: ['SUPPLIER'],
  admin: ['ADMIN', 'SUPER_ADMIN'],
};

export const DEV_SERVICE_SECRETS: Record<ServiceName, string> = {
  buyer: 'matsrc-buyer-dev-secret',
  supplier: 'matsrc-supplier-dev-secret',
  admin: 'matsrc-admin-dev-secret',
};

export const DEV_ASSERTION_SECRETS: Record<ServiceName | 'default', string> = {
  buyer: 'matsrc-buyer-assertion-dev-secret',
  supplier: 'matsrc-supplier-assertion-dev-secret',
  admin: 'matsrc-admin-assertion-dev-secret',
  default: 'matsrc-assertion-dev-secret',
};

export const DEV_ASSERTION_SECRET = 'matsrc-assertion-dev-secret';

export function getServiceSecret(serviceName: ServiceName): string {
  let secret: string | undefined;
  switch (serviceName) {
    case 'buyer':
      secret = process.env.BUYER_SERVICE_SECRET;
      break;
    case 'supplier':
      secret = process.env.SUPPLIER_SERVICE_SECRET;
      break;
    case 'admin':
      secret = process.env.ADMIN_SERVICE_SECRET;
      break;
  }

  if (!secret) {
    if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL_ENV && !process.env.BUILDOHUB_ENV) {
      return DEV_SERVICE_SECRETS[serviceName];
    }
    throw new UnauthorizedException(`Service secret not configured for ${serviceName}`);
  }

  return secret;
}

export function getAssertionSecret(serviceName?: ServiceName): string {
  let secret: string | undefined;
  if (serviceName === 'buyer') {
    secret = process.env.BUYER_ASSERTION_SECRET;
  } else if (serviceName === 'supplier') {
    secret = process.env.SUPPLIER_ASSERTION_SECRET;
  } else if (serviceName === 'admin') {
    secret = process.env.ADMIN_ASSERTION_SECRET;
  }

  if (!secret) {
    secret = process.env.IDENTITY_ASSERTION_SECRET;
  }

  if (!secret) {
    if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL_ENV && !process.env.BUILDOHUB_ENV) {
      return DEV_ASSERTION_SECRETS[serviceName || 'default'];
    }
    throw new UnauthorizedException(`Identity assertion secret not configured for ${serviceName || 'service'}`);
  }

  return secret;
}

export function getJwtSecret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET || 'your-secret-key';
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function signServiceAssertion(
  payload: Omit<ServiceUserAssertion, 'iss' | 'aud' | 'exp' | 'iat'>,
  serviceName: ServiceName,
  options?: { expiresInSeconds?: number; secret?: string }
): string {
  const secret = options?.secret || getAssertionSecret(serviceName);
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = options?.expiresInSeconds ?? 300; // 5 minutes default

  const fullPayload: ServiceUserAssertion = {
    ...payload,
    iss: `matsrc-${serviceName}`,
    aud: 'matsrc-api',
    iat: now,
    exp: now + expiresIn,
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(fullPayload));
  const data = `${headerB64}.${payloadB64}`;
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64url');

  return `${data}.${signature}`;
}

export function verifyServiceAssertion(
  token: string,
  serviceName: ServiceName,
  providedSecret?: string
): ServiceUserAssertion {
  const secret = providedSecret || getAssertionSecret(serviceName);
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new UnauthorizedException('Invalid assertion token format');
  }

  const [headerB64, payloadB64, signature] = parts;
  const data = `${headerB64}.${payloadB64}`;
  const expectedSignature = crypto.createHmac('sha256', secret).update(data).digest('base64url');

  if (!timingSafeCompare(signature, expectedSignature)) {
    throw new UnauthorizedException('Invalid assertion signature');
  }

  let payload: ServiceUserAssertion;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw new UnauthorizedException('Malformed assertion payload');
  }

  if (!payload.sub || !payload.email || !payload.role) {
    throw new UnauthorizedException('Assertion missing required identity claims');
  }

  // Check expiration (allow 60s clock skew)
  if (payload.exp !== undefined) {
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now - 60) {
      throw new UnauthorizedException('User assertion token expired');
    }
  }

  // Check issuer if present
  if (payload.iss && payload.iss !== `matsrc-${serviceName}` && payload.iss !== `matsrc-auth-${serviceName}`) {
    throw new UnauthorizedException(`Invalid assertion issuer: ${payload.iss}`);
  }

  // Check audience if present
  if (payload.aud && payload.aud !== 'matsrc-api') {
    throw new UnauthorizedException(`Invalid assertion audience: ${payload.aud}`);
  }

  // Enforce service role boundaries
  const allowedRoles = PERMITTED_SERVICE_ROLES[serviceName];
  if (!allowedRoles || !allowedRoles.includes(payload.role)) {
    throw new ForbiddenException(
      `Service '${serviceName}' is not authorized to assert role '${payload.role}'. Permitted roles: ${allowedRoles?.join(', ')}`
    );
  }

  return payload;
}

export function verifyBearerToken(token: string): ServiceUserAssertion {
  const secret = getJwtSecret();
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new UnauthorizedException('Invalid JWT format');
  }

  const [headerB64, payloadB64, signature] = parts;
  const data = `${headerB64}.${payloadB64}`;
  const expectedSignature = crypto.createHmac('sha256', secret).update(data).digest('base64url');

  if (!timingSafeCompare(signature, expectedSignature)) {
    throw new UnauthorizedException('Invalid JWT signature');
  }

  let payload: any;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw new UnauthorizedException('Malformed JWT payload');
  }

  if (payload.exp !== undefined) {
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now - 60) {
      throw new UnauthorizedException('JWT token expired');
    }
  }

  const sub = payload.sub || payload.userId;
  const email = payload.email;
  const role = payload.role || 'BUILDER';

  if (!sub || !email) {
    throw new UnauthorizedException('JWT missing required identity claims');
  }

  return {
    sub,
    email,
    role,
    name: payload.name,
    phone: payload.phone,
    exp: payload.exp,
    iat: payload.iat,
  };
}

