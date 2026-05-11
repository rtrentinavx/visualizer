import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export const config = {
  runtime: 'edge',
};

export default async function handler(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || 'default';

  if (request.method === 'GET') {
    try {
      const data = await redis.get(`dcf-topology:${id}`);
      if (!data) {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ topology: data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      return new Response(JSON.stringify({ error: 'Failed to load' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (request.method === 'POST') {
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Request body too large. Max 1MB.' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    try {
      const body = await request.json();
      await redis.set(`dcf-topology:${id}`, JSON.stringify(body.topology), { ex: 60 * 60 * 24 * 30 }); // 30 days
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      return new Response(JSON.stringify({ error: 'Failed to save' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });
}
