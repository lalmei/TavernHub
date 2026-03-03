import { writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import type { APIRoute } from 'astro';
import { getSession, getToken, setTokenImage } from '@/lib/db';
import { randomId } from '@/lib/id';
import { ensureWsHub, publishTokenUpdated } from '@/lib/wsHub';

const MAX_TOKEN_IMAGE_BYTES = 2 * 1024 * 1024;
const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

ensureWsHub();

function extFor(file: File): string {
  const fromName = extname(file.name);
  if (fromName) return fromName;
  if (file.type === 'image/png') return '.png';
  if (file.type === 'image/webp') return '.webp';
  return '.jpg';
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

export const POST: APIRoute = async ({ params, request }) => {
  const sessionId = params.id;
  const tokenId = params.tokenId;

  if (!sessionId || !tokenId) return json({ error: 'Missing ids' }, 400);
  if (!getSession(sessionId)) return json({ error: 'Session not found' }, 404);

  const token = getToken(sessionId, tokenId);
  if (!token) return json({ error: 'Token not found' }, 404);

  const form = await request.formData();
  const file = form.get('image');
  if (!(file instanceof File)) return json({ error: 'Missing image file' }, 400);
  if (!allowedTypes.has(file.type)) return json({ error: 'Unsupported file type' }, 400);
  if (file.size > MAX_TOKEN_IMAGE_BYTES) return json({ error: 'Image file too large' }, 400);

  const filename = `${randomId('token_')}${extFor(file)}`;
  const path = resolve(process.cwd(), 'public', 'uploads', filename);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path, bytes);

  const updated = setTokenImage(sessionId, token.id, `/uploads/${filename}`);
  if (!updated) return json({ error: 'Token not found' }, 404);

  publishTokenUpdated(sessionId, updated);
  return json({ token: updated }, 200);
};

export const DELETE: APIRoute = async ({ params }) => {
  const sessionId = params.id;
  const tokenId = params.tokenId;

  if (!sessionId || !tokenId) return json({ error: 'Missing ids' }, 400);
  if (!getSession(sessionId)) return json({ error: 'Session not found' }, 404);

  const token = getToken(sessionId, tokenId);
  if (!token) return json({ error: 'Token not found' }, 404);

  const updated = setTokenImage(sessionId, token.id, null);
  if (!updated) return json({ error: 'Token not found' }, 404);

  publishTokenUpdated(sessionId, updated);
  return json({ token: updated }, 200);
};
