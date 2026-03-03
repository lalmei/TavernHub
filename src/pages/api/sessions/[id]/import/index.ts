import type { APIRoute } from 'astro';
import { getSession, importUniversalVtt } from '@/lib/db';
import { universalVttSchema } from '@/lib/validation';
import { ensureWsHub, publishSnapshot } from '@/lib/wsHub';

ensureWsHub();

export const POST: APIRoute = async ({ params, request }) => {
  const sessionId = params.id;
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'Missing session id' }), { status: 400 });
  }

  if (!getSession(sessionId)) {
    return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 });
  }

  try {
    const payload = universalVttSchema.parse(await request.json());
    const snapshot = importUniversalVtt(sessionId, payload);
    publishSnapshot(sessionId);
    return new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid VTT file' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }
};
