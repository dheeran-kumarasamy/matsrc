export async function POST(req: Request, { params }: { params: { slug: string[] } }) {
  const slug = params.slug?.join('/') || '';
  // Use environment variable or default to localhost for development
  const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:4000/api';
  
  try {
    const body = await req.json().catch(() => ({}));
    
    const response = await fetch(`${backendUrl}/${slug}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': req.headers.get('X-User-Id') || 'builder.demo@buildmart.local',
        'X-User-Email': req.headers.get('X-User-Email') || 'builder.demo@buildmart.local',
        'X-User-Name': req.headers.get('X-User-Name') || 'Demo Builder',
        'X-User-Role': req.headers.get('X-User-Role') || 'BUILDER',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    console.error('API proxy error:', error);
    return Response.json(
      { error: 'Failed to proxy request to backend API' },
      { status: 500 }
    );
  }
}

export async function GET(req: Request, { params }: { params: { slug: string[] } }) {
  const slug = params.slug?.join('/') || '';
  const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:4000/api';
  
  try {
    const response = await fetch(`${backendUrl}/${slug}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': req.headers.get('X-User-Id') || 'builder.demo@buildmart.local',
        'X-User-Email': req.headers.get('X-User-Email') || 'builder.demo@buildmart.local',
        'X-User-Name': req.headers.get('X-User-Name') || 'Demo Builder',
        'X-User-Role': req.headers.get('X-User-Role') || 'BUILDER',
      },
      cache: 'no-store',
    });

    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    console.error('API proxy error:', error);
    return Response.json(
      { error: 'Failed to proxy request to backend API' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, { params }: { params: { slug: string[] } }) {
  const slug = params.slug?.join('/') || '';
  const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:4000/api';
  
  try {
    const response = await fetch(`${backendUrl}/${slug}`, {
      method: 'DELETE',
      headers: {
        'X-User-Id': req.headers.get('X-User-Id') || 'builder.demo@buildmart.local',
        'X-User-Email': req.headers.get('X-User-Email') || 'builder.demo@buildmart.local',
        'X-User-Name': req.headers.get('X-User-Name') || 'Demo Builder',
        'X-User-Role': req.headers.get('X-User-Role') || 'BUILDER',
      },
    });

    if (response.status === 204) {
      return new Response(null, { status: 204 });
    }

    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    console.error('API proxy error:', error);
    return Response.json(
      { error: 'Failed to proxy request to backend API' },
      { status: 500 }
    );
  }
}
