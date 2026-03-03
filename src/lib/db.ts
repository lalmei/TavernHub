import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import type {
  MapRecord,
  Point,
  PortalRecord,
  SceneGeometry,
  SceneSettings,
  SessionRecord,
  SessionSnapshot,
  TokenRecord,
  UniversalVttFile
} from '@/lib/types';
import { randomId } from '@/lib/id';
import { normalizePortals } from '@/lib/visibility';

const dbPath = resolve(process.cwd(), 'data', 'auvtt.db');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeBase64(input: string): string {
  return input.replace(/\s+/g, '');
}

function detectBase64ImageMime(base64: string): string | null {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBOR')) return 'image/png';
  if (base64.startsWith('UklGR')) return 'image/webp';
  if (base64.startsWith('R0lGOD')) return 'image/gif';
  return null;
}

function maybeDataUrlFromBareBase64(input: string): string | null {
  const compact = normalizeBase64(input);
  const mime = detectBase64ImageMime(compact);
  if (mime) {
    return `data:${mime};base64,${compact}`;
  }

  const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(compact) && compact.length > 512;
  if (looksBase64) {
    // Fallback for uncommon encoders without a recognizable magic header.
    return `data:image/jpeg;base64,${compact}`;
  }
  return null;
}

function normalizeUniversalVttImageRef(imageRef: string | undefined, fallback: string): string {
  if (!imageRef || !imageRef.trim()) return fallback;
  const value = imageRef.trim();
  if (value.startsWith('data:image/')) return value;
  const fromBareBase64 = maybeDataUrlFromBareBase64(value);
  if (fromBareBase64) return fromBareBase64;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  if (value.startsWith('/')) return value;
  return `/uploads/${basename(value)}`;
}

function migrate(): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS maps (
      session_id TEXT PRIMARY KEY,
      image_url TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      grid_size INTEGER,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tokens (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      size REAL NOT NULL,
      role TEXT NOT NULL,
      vision_enabled INTEGER NOT NULL,
      vision_radius REAL NOT NULL,
      image_url TEXT,
      visible INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scene_settings (
      session_id TEXT PRIMARY KEY,
      fog_enabled INTEGER NOT NULL,
      global_light INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scene_geometry (
      session_id TEXT PRIMARY KEY,
      line_of_sight_json TEXT NOT NULL,
      portals_json TEXT NOT NULL,
      lights_json TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tokens_session_id ON tokens(session_id);
  `);

  const tokenColumns = db.prepare("PRAGMA table_info('tokens')").all() as Array<{ name: string }>;
  const hasImageUrl = tokenColumns.some((column) => column.name === 'image_url');
  if (!hasImageUrl) {
    db.exec('ALTER TABLE tokens ADD COLUMN image_url TEXT');
  }
}

migrate();

function mapRowToSession(row: any): SessionRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRowToToken(row: any): TokenRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    name: row.name,
    x: row.x,
    y: row.y,
    size: row.size,
    role: row.role,
    vision: {
      enabled: Boolean(row.vision_enabled),
      radius: row.vision_radius,
      shape: 'circle'
    },
    visible: Boolean(row.visible),
    imageUrl: row.image_url ?? null
  };
}

function mapRowToMap(row: any): MapRecord {
  return {
    sessionId: row.session_id,
    imageUrl: row.image_url,
    width: row.width,
    height: row.height,
    gridSize: row.grid_size
  };
}

function mapRowToScene(row: any): SceneSettings {
  return {
    sessionId: row.session_id,
    fogEnabled: Boolean(row.fog_enabled),
    globalLight: Boolean(row.global_light)
  };
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapRowToGeometry(row: any): SceneGeometry {
  const rawPortals = safeJsonParse<Array<Record<string, unknown>>>(row.portals_json, []);
  return {
    sessionId: row.session_id,
    lineOfSight: safeJsonParse<Point[][]>(row.line_of_sight_json, []),
    portals: normalizePortals(rawPortals),
    lights: safeJsonParse<Array<Record<string, unknown>>>(row.lights_json, [])
  };
}

export function createSession(name: string): SessionRecord {
  const id = randomId('s_');
  const at = nowIso();
  db.prepare('INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, name, at, at);
  db.prepare('INSERT INTO scene_settings (session_id, fog_enabled, global_light) VALUES (?, ?, ?)').run(id, 1, 0);
  db.prepare(
    'INSERT INTO scene_geometry (session_id, line_of_sight_json, portals_json, lights_json) VALUES (?, ?, ?, ?)'
  ).run(id, '[]', '[]', '[]');
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  return mapRowToSession(row);
}

export function getSession(id: string): SessionRecord | null {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  return row ? mapRowToSession(row) : null;
}

export function updateSessionTimestamp(id: string): void {
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(nowIso(), id);
}

export function upsertMap(map: Omit<MapRecord, 'sessionId'> & { sessionId: string }): MapRecord {
  db.prepare(
    `INSERT INTO maps (session_id, image_url, width, height, grid_size)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       image_url = excluded.image_url,
       width = excluded.width,
       height = excluded.height,
       grid_size = excluded.grid_size`
  ).run(map.sessionId, map.imageUrl, map.width, map.height, map.gridSize ?? null);
  updateSessionTimestamp(map.sessionId);
  const row = db.prepare('SELECT * FROM maps WHERE session_id = ?').get(map.sessionId);
  return mapRowToMap(row);
}

export function getMap(sessionId: string): MapRecord | null {
  const row = db.prepare('SELECT * FROM maps WHERE session_id = ?').get(sessionId);
  return row ? mapRowToMap(row) : null;
}

export function upsertScene(scene: SceneSettings): SceneSettings {
  db.prepare(
    `INSERT INTO scene_settings (session_id, fog_enabled, global_light)
     VALUES (?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       fog_enabled = excluded.fog_enabled,
       global_light = excluded.global_light`
  ).run(scene.sessionId, scene.fogEnabled ? 1 : 0, scene.globalLight ? 1 : 0);
  updateSessionTimestamp(scene.sessionId);
  const row = db.prepare('SELECT * FROM scene_settings WHERE session_id = ?').get(scene.sessionId);
  return mapRowToScene(row);
}

export function getScene(sessionId: string): SceneSettings {
  const row = db.prepare('SELECT * FROM scene_settings WHERE session_id = ?').get(sessionId);
  if (!row) {
    return upsertScene({ sessionId, fogEnabled: true, globalLight: false });
  }
  return mapRowToScene(row);
}

export function upsertSceneGeometry(geometry: SceneGeometry): SceneGeometry {
  db.prepare(
    `INSERT INTO scene_geometry (session_id, line_of_sight_json, portals_json, lights_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       line_of_sight_json = excluded.line_of_sight_json,
       portals_json = excluded.portals_json,
       lights_json = excluded.lights_json`
  ).run(
    geometry.sessionId,
    JSON.stringify(geometry.lineOfSight),
    JSON.stringify(geometry.portals.map((portal) => ({ id: portal.id, a: portal.a, b: portal.b, closed: portal.closed }))),
    JSON.stringify(geometry.lights)
  );
  updateSessionTimestamp(geometry.sessionId);
  const row = db.prepare('SELECT * FROM scene_geometry WHERE session_id = ?').get(geometry.sessionId);
  return mapRowToGeometry(row);
}

export function getSceneGeometry(sessionId: string): SceneGeometry {
  const row = db.prepare('SELECT * FROM scene_geometry WHERE session_id = ?').get(sessionId);
  if (!row) {
    return upsertSceneGeometry({
      sessionId,
      lineOfSight: [],
      portals: [],
      lights: []
    });
  }
  return mapRowToGeometry(row);
}

export function setPortalState(sessionId: string, portalId: string, closed: boolean): SceneGeometry | null {
  const geometry = getSceneGeometry(sessionId);
  const updatedPortals: PortalRecord[] = geometry.portals.map((portal) =>
    portal.id === portalId ? { ...portal, closed } : portal
  );
  if (!updatedPortals.some((portal) => portal.id === portalId)) {
    return null;
  }
  return upsertSceneGeometry({
    ...geometry,
    portals: updatedPortals
  });
}

export function addToken(token: TokenRecord): TokenRecord {
  db.prepare(
    `INSERT INTO tokens (id, session_id, name, x, y, size, role, vision_enabled, vision_radius, image_url, visible)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    token.id,
    token.sessionId,
    token.name,
    token.x,
    token.y,
    token.size,
    token.role,
    token.vision.enabled ? 1 : 0,
    token.vision.radius,
    token.imageUrl,
    token.visible ? 1 : 0
  );
  updateSessionTimestamp(token.sessionId);
  return token;
}

export function updateToken(token: TokenRecord): TokenRecord {
  db.prepare(
    `UPDATE tokens SET
      name = ?, x = ?, y = ?, size = ?, role = ?, vision_enabled = ?, vision_radius = ?, image_url = ?, visible = ?
     WHERE id = ? AND session_id = ?`
  ).run(
    token.name,
    token.x,
    token.y,
    token.size,
    token.role,
    token.vision.enabled ? 1 : 0,
    token.vision.radius,
    token.imageUrl,
    token.visible ? 1 : 0,
    token.id,
    token.sessionId
  );
  updateSessionTimestamp(token.sessionId);
  return token;
}

export function moveToken(sessionId: string, id: string, x: number, y: number): void {
  db.prepare('UPDATE tokens SET x = ?, y = ? WHERE id = ? AND session_id = ?').run(x, y, id, sessionId);
  updateSessionTimestamp(sessionId);
}

export function deleteToken(sessionId: string, id: string): void {
  db.prepare('DELETE FROM tokens WHERE id = ? AND session_id = ?').run(id, sessionId);
  updateSessionTimestamp(sessionId);
}

export function getTokens(sessionId: string): TokenRecord[] {
  const rows = db.prepare('SELECT * FROM tokens WHERE session_id = ?').all(sessionId);
  return rows.map(mapRowToToken);
}

export function getToken(sessionId: string, tokenId: string): TokenRecord | null {
  const row = db.prepare('SELECT * FROM tokens WHERE session_id = ? AND id = ?').get(sessionId, tokenId);
  return row ? mapRowToToken(row) : null;
}

export function setTokenImage(sessionId: string, tokenId: string, imageUrl: string | null): TokenRecord | null {
  db.prepare('UPDATE tokens SET image_url = ? WHERE session_id = ? AND id = ?').run(imageUrl, sessionId, tokenId);
  updateSessionTimestamp(sessionId);
  return getToken(sessionId, tokenId);
}

export function getSnapshot(sessionId: string): SessionSnapshot | null {
  const session = getSession(sessionId);
  if (!session) return null;
  return {
    session,
    map: getMap(sessionId),
    scene: getScene(sessionId),
    geometry: getSceneGeometry(sessionId),
    tokens: getTokens(sessionId)
  };
}

export function importUniversalVtt(sessionId: string, file: UniversalVttFile): SessionSnapshot | null {
  const ppg = file.resolution.pixels_per_grid;
  const rawMapWidth = file.resolution.map_size.x;
  const rawMapHeight = file.resolution.map_size.y;
  const usesGridUnits = rawMapWidth <= 256 && rawMapHeight <= 256 && ppg > 1;
  const mapWidth = Math.round(usesGridUnits ? rawMapWidth * ppg : rawMapWidth);
  const mapHeight = Math.round(usesGridUnits ? rawMapHeight * ppg : rawMapHeight);
  const gridSize = Math.round(ppg);
  const ext = file.extensions?.auvtt;
  const scale = usesGridUnits ? ppg : 1;
  const lineOfSight = (file.line_of_sight ?? []).map((polyline) =>
    polyline.map((pt) => ({
      x: pt.x * scale,
      y: pt.y * scale
    }))
  );
  const portals = normalizePortals((file.portals ?? []) as Array<Record<string, unknown>>, scale);

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM tokens WHERE session_id = ?').run(sessionId);

    const existingMap = getMap(sessionId);
    upsertMap({
      sessionId,
      imageUrl: normalizeUniversalVttImageRef(file.image, existingMap?.imageUrl ?? ''),
      width: mapWidth,
      height: mapHeight,
      gridSize: Number.isFinite(gridSize) ? gridSize : null
    });

    upsertScene({
      sessionId,
      fogEnabled: ext?.scene?.fogEnabled ?? true,
      globalLight: ext?.scene?.globalLight ?? false
    });

    upsertSceneGeometry({
      sessionId,
      lineOfSight,
      portals,
      lights: (file.lights ?? []) as Array<Record<string, unknown>>
    });

    for (const t of ext?.tokens ?? []) {
      addToken({
        id: t.id,
        sessionId,
        name: t.name,
        x: t.x,
        y: t.y,
        size: t.size,
        role: t.role,
        vision: t.vision,
        visible: t.visible,
        imageUrl: t.imageUrl ?? null
      });
    }
  });
  tx();
  updateSessionTimestamp(sessionId);
  return getSnapshot(sessionId);
}

export function exportUniversalVtt(sessionId: string): UniversalVttFile | null {
  const snapshot = getSnapshot(sessionId);
  if (!snapshot) return null;
  const ppg = snapshot.map?.gridSize ?? 70;
  return {
    format: 0.3,
    resolution: {
      map_origin: { x: 0, y: 0 },
      map_size: {
        x: Math.round((snapshot.map?.width ?? 1200) / ppg),
        y: Math.round((snapshot.map?.height ?? 800) / ppg)
      },
      pixels_per_grid: ppg
    },
    image: snapshot.map?.imageUrl,
    line_of_sight: snapshot.geometry.lineOfSight.map((polyline) =>
      polyline.map((pt) => ({
        x: pt.x / ppg,
        y: pt.y / ppg
      }))
    ),
    portals: snapshot.geometry.portals.map((portal) => ({
      bounds: [
        { x: portal.a.x / ppg, y: portal.a.y / ppg },
        { x: portal.b.x / ppg, y: portal.b.y / ppg }
      ],
      closed: portal.closed
    })),
    lights: snapshot.geometry.lights as UniversalVttFile['lights'],
    extensions: {
      auvtt: {
        scene: {
          fogEnabled: snapshot.scene.fogEnabled,
          globalLight: snapshot.scene.globalLight
        },
        tokens: snapshot.tokens.map((token) => ({
          id: token.id,
          name: token.name,
          x: token.x,
          y: token.y,
          size: token.size,
          role: token.role,
          vision: token.vision,
          visible: token.visible,
          imageUrl: token.imageUrl ?? null
        }))
      }
    }
  };
}
