import type { APIRoute } from 'astro';
import { exportUniversalVtt } from '@/lib/db';

export const GET: APIRoute = async ({ params }) => {
  const sessionId = params.id;
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'Missing session id' }), { status: 400 });
  }

  const payload = exportUniversalVtt(sessionId);
  if (!payload) {
    return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 });
  }

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="${sessionId}.dd2vtt"`
    }
  });
};
