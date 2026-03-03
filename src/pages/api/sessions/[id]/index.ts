import type { APIRoute } from 'astro';
import { getSnapshot } from '@/lib/db';
import { ensureWsHub } from '@/lib/wsHub';

ensureWsHub();

export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing session id' }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }

  const snapshot = getSnapshot(id);
  if (!snapshot) {
    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' }
    });
  }

  return new Response(JSON.stringify(snapshot), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};
