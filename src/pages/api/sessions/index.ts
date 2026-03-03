import type { APIRoute } from 'astro';
import { createSession } from '@/lib/db';
import { createSessionSchema } from '@/lib/validation';
import { ensureWsHub } from '@/lib/wsHub';

ensureWsHub();

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = createSessionSchema.parse(await request.json());
    const session = createSession(body.name);
    return new Response(JSON.stringify({ session }), {
      status: 201,
      headers: { 'content-type': 'application/json' }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid payload' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }
};
