import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getBuyerServiceHeaders } from '@/lib/service-auth';
import {
  isAllowedRoute,
  containsPathTraversal,
  MAX_BODY_BYTES,
  getBackendApiUrl,
} from '@/lib/buyer-proxy';

async function handleProxyRequest(req: NextRequest, { params }: { params: { slug: string[] } }) {
  const rawSlug = (params.slug || []).join('/');
  const method = req.method.toUpperCase();

  // 1. Path traversal and malformed path rejection
  if (containsPathTraversal(rawSlug)) {
    return NextResponse.json(
      { error: 'Path traversal or invalid path sequence rejected' },
      { status: 403 }
    );
  }

  // 2. Enforce exact route allowlist
  if (!isAllowedRoute(rawSlug, method)) {
    return NextResponse.json(
      { error: `Route not allowed in buyer proxy: ${method} /${rawSlug}` },
      { status: 403 }
    );
  }

  // 3. Origin / Host verification for state-changing methods
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const origin = req.headers.get('origin');
    const host = req.headers.get('host');
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          return NextResponse.json(
            { error: 'Cross-origin request forbidden' },
            { status: 403 }
          );
        }
      } catch {
        return NextResponse.json(
          { error: 'Invalid origin header' },
          { status: 403 }
        );
      }
    }
  }

  // 4. Check Content-Length if present
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'Payload exceeds maximum allowed size (1MB)' },
      { status: 413 }
    );
  }

  // 5. User session resolution
  const session = await auth();
  const user = session?.user;

  // For protected builder routes, authentication is strictly required
  if (rawSlug.startsWith('builder/')) {
    if (!user?.email) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
    const role = (user as any).role || 'BUILDER';
    if (role !== 'BUILDER') {
      return NextResponse.json(
        { error: 'Forbidden: only BUILDER role is authorized' },
        { status: 403 }
      );
    }
  }

  // 6. Construct authenticated service headers (never forward incoming x-user-* headers)
  let serviceHeaders: Record<string, string>;
  try {
    serviceHeaders = getBuyerServiceHeaders(user);
  } catch (err: any) {
    console.error('[buyer-proxy] Failed to generate service authentication:', err.message);
    return NextResponse.json(
      { error: 'Internal service authentication configuration error' },
      { status: 500 }
    );
  }

  const outgoingHeaders: Record<string, string> = {
    ...serviceHeaders,
    'Accept': req.headers.get('accept') || 'application/json',
  };

  const contentType = req.headers.get('content-type');
  if (contentType) {
    outgoingHeaders['Content-Type'] = contentType;
  }

  // 7. Backend API resolution
  let backendUrl: string;
  try {
    backendUrl = getBackendApiUrl();
  } catch (err: any) {
    console.error('[buyer-proxy] Missing backend API URL:', err.message);
    return NextResponse.json(
      { error: 'Backend API URL not configured' },
      { status: 500 }
    );
  }

  // 8. Streaming body size verification
  let body: BodyInit | null = null;
  if (method !== 'GET' && method !== 'HEAD') {
    try {
      const buffer = await req.arrayBuffer();
      if (buffer.byteLength > MAX_BODY_BYTES) {
        return NextResponse.json(
          { error: 'Payload exceeds maximum allowed size (1MB)' },
          { status: 413 }
        );
      }
      body = buffer;
    } catch {
      body = null;
    }
  }

  // 9. Dispatch to backend API
  try {
    const upstreamResponse = await fetch(`${backendUrl}/${rawSlug}`, {
      method,
      headers: outgoingHeaders,
      body,
      cache: 'no-store',
    });

    const responseContentType = upstreamResponse.headers.get('content-type') || '';
    if (responseContentType.includes('application/json')) {
      const data = await upstreamResponse.json();
      return NextResponse.json(data, { status: upstreamResponse.status });
    }

    // Binary responses (PDF, images) or non-JSON payloads must use arrayBuffer()
    // to preserve exact byte fidelity and avoid UTF-8 string decoding corruption.
    const buffer = await upstreamResponse.arrayBuffer();
    const responseHeaders = new Headers();
    if (responseContentType) {
      responseHeaders.set('Content-Type', responseContentType);
    }
    const contentDisposition = upstreamResponse.headers.get('content-disposition');
    if (contentDisposition) {
      responseHeaders.set('Content-Disposition', contentDisposition);
    }

    return new NextResponse(buffer, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (error: any) {
    console.error(`[buyer-proxy] Error proxying ${method} /${rawSlug}:`, error.message);
    return NextResponse.json(
      { error: 'Failed to proxy request to backend API' },
      { status: 502 }
    );
  }
}

export const GET = handleProxyRequest;
export const POST = handleProxyRequest;
export const PATCH = handleProxyRequest;
export const DELETE = handleProxyRequest;
