import { writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import type { APIRoute } from 'astro';
import { getSession, upsertMap } from '@/lib/db';
import { randomId } from '@/lib/id';
import { uploadMapSchema } from '@/lib/validation';
import { ensureWsHub, publishSnapshot } from '@/lib/wsHub';

const MAX_MAP_BYTES = 12 * 1024 * 1024;
const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
ensureWsHub();

export const POST: APIRoute = async ({ params, request }) => {
  const sessionId = params.id;
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'Missing session id' }), { status: 400 });
  }

  if (!getSession(sessionId)) {
    return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 });
  }

  const form = await request.formData();
  const file = form.get('map');
  const width = Number(form.get('width'));
  const height = Number(form.get('height'));
  const gridSizeRaw = form.get('gridSize');

  if (!(file instanceof File)) {
    return new Response(JSON.stringify({ error: 'Missing map file' }), { status: 400 });
  }

  if (!allowedTypes.has(file.type)) {
    return new Response(JSON.stringify({ error: 'Unsupported file type' }), { status: 400 });
  }

  if (file.size > MAX_MAP_BYTES) {
    return new Response(JSON.stringify({ error: 'Map file too large' }), { status: 400 });
  }

  const parsed = uploadMapSchema.safeParse({
    width,
    height,
    gridSize: gridSizeRaw ? Number(gridSizeRaw) : null
  });

  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.flatten() }), { status: 400 });
  }

  const ext = extname(file.name) || (file.type === 'image/png' ? '.png' : file.type === 'image/webp' ? '.webp' : '.jpg');
  const filename = `${randomId('map_')}${ext}`;
  const path = resolve(process.cwd(), 'public', 'uploads', filename);

  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path, bytes);

  const map = upsertMap({
    sessionId,
    imageUrl: `/uploads/${filename}`,
    width: parsed.data.width,
    height: parsed.data.height,
    gridSize: parsed.data.gridSize ?? null
  });
  publishSnapshot(sessionId);

  return new Response(JSON.stringify({ map }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};
