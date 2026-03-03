import type { Point, PortalRecord, TokenRecord } from '@/lib/types';

export interface Circle {
  x: number;
  y: number;
  radius: number;
}

export interface Segment {
  a: Point;
  b: Point;
}

interface RawPortalLike {
  id?: unknown;
  bounds?: unknown;
  closed?: unknown;
  a?: unknown;
  b?: unknown;
}

export function playerVisionCircles(tokens: TokenRecord[]): Circle[] {
  return tokens
    .filter((token) => token.role === 'player' && token.vision.enabled && token.visible)
    .map((token) => ({
      x: token.x,
      y: token.y,
      radius: token.vision.radius
    }));
}

export function pointVisible(x: number, y: number, circles: Circle[]): boolean {
  for (const circle of circles) {
    const dx = x - circle.x;
    const dy = y - circle.y;
    if (dx * dx + dy * dy <= circle.radius * circle.radius) {
      return true;
    }
  }
  return false;
}

export function segmentsFromPolylines(polylines: Point[][]): Segment[] {
  const segments: Segment[] = [];
  for (const polyline of polylines) {
    if (polyline.length < 2) continue;
    for (let i = 0; i < polyline.length - 1; i += 1) {
      segments.push({ a: polyline[i], b: polyline[i + 1] });
    }
  }
  return segments;
}

function asPoint(value: unknown): Point | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { x?: unknown; y?: unknown };
  if (typeof candidate.x !== 'number' || typeof candidate.y !== 'number') return null;
  if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return null;
  return { x: candidate.x, y: candidate.y };
}

function decodePortalBounds(bounds: unknown): [Point, Point] | null {
  if (!Array.isArray(bounds)) return null;
  if (bounds.length === 4 && bounds.every((value) => typeof value === 'number')) {
    const [x1, y1, x2, y2] = bounds as [number, number, number, number];
    return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  }

  if (bounds.length >= 4 && bounds.every((value) => typeof value === 'number')) {
    const [x1, y1, x2, y2] = bounds as number[];
    return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  }

  if (bounds.length >= 2) {
    const a = asPoint(bounds[0]);
    const b = asPoint(bounds[1]);
    if (a && b) return [a, b];
  }

  return null;
}

export function normalizePortals(portalsRaw: Array<Record<string, unknown>>, scale = 1): PortalRecord[] {
  const normalized: PortalRecord[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < portalsRaw.length; i += 1) {
    const raw = portalsRaw[i] as RawPortalLike;
    const baseId = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `portal_${i}`;
    let id = baseId;
    let suffix = 1;
    while (seen.has(id)) {
      id = `${baseId}_${suffix}`;
      suffix += 1;
    }

    const points = raw.bounds ? decodePortalBounds(raw.bounds) : null;
    const fallbackA = asPoint(raw.a);
    const fallbackB = asPoint(raw.b);
    const aRaw = points?.[0] ?? fallbackA;
    const bRaw = points?.[1] ?? fallbackB;
    if (!aRaw || !bRaw) continue;

    const a = { x: aRaw.x * scale, y: aRaw.y * scale };
    const b = { x: bRaw.x * scale, y: bRaw.y * scale };
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (dx * dx + dy * dy < 1e-6) continue;

    normalized.push({
      id,
      a,
      b,
      closed: typeof raw.closed === 'boolean' ? raw.closed : true
    });
    seen.add(id);
  }

  return normalized;
}

export function segmentsFromClosedPortals(portals: PortalRecord[]): Segment[] {
  return portals.filter((portal) => portal.closed).map((portal) => ({ a: portal.a, b: portal.b }));
}

function distanceToSegment(point: Point, segment: Segment): number {
  const vx = segment.b.x - segment.a.x;
  const vy = segment.b.y - segment.a.y;
  const wx = point.x - segment.a.x;
  const wy = point.y - segment.a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) {
    const dx = point.x - segment.a.x;
    const dy = point.y - segment.a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) {
    const dx = point.x - segment.b.x;
    const dy = point.y - segment.b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  const ratio = c1 / c2;
  const px = segment.a.x + ratio * vx;
  const py = segment.a.y + ratio * vy;
  const dx = point.x - px;
  const dy = point.y - py;
  return Math.sqrt(dx * dx + dy * dy);
}

export function hitTestPortal(point: Point, portals: PortalRecord[], threshold: number): string | null {
  for (let i = portals.length - 1; i >= 0; i -= 1) {
    const portal = portals[i];
    const distance = distanceToSegment(point, { a: portal.a, b: portal.b });
    if (distance <= threshold) return portal.id;
  }
  return null;
}

export function adaptiveRaySweep(radius: number): number {
  const base = 180;
  const extra = Math.floor(Math.max(0, radius) / 4);
  return Math.max(base, Math.min(720, base + extra));
}

function raySegmentIntersection(origin: Point, angle: number, segment: Segment): number | null {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  const x1 = segment.a.x;
  const y1 = segment.a.y;
  const x2 = segment.b.x;
  const y2 = segment.b.y;

  const rdx = dx;
  const rdy = dy;
  const sdx = x2 - x1;
  const sdy = y2 - y1;
  const denom = rdx * sdy - rdy * sdx;
  if (Math.abs(denom) < 1e-9) return null;

  const ox = x1 - origin.x;
  const oy = y1 - origin.y;
  const t = (ox * sdy - oy * sdx) / denom;
  const u = (ox * rdy - oy * rdx) / denom;

  if (t >= 0 && u >= 0 && u <= 1) return t;
  return null;
}

function mapBoundsSegments(width: number, height: number): Segment[] {
  return [
    { a: { x: 0, y: 0 }, b: { x: width, y: 0 } },
    { a: { x: width, y: 0 }, b: { x: width, y: height } },
    { a: { x: width, y: height }, b: { x: 0, y: height } },
    { a: { x: 0, y: height }, b: { x: 0, y: 0 } }
  ];
}

export function visibilityPolygonForToken(
  origin: Point,
  radius: number,
  wallSegments: Segment[],
  mapWidth: number,
  mapHeight: number
): Point[] {
  const eps = 1e-4;
  const segments = [...wallSegments, ...mapBoundsSegments(mapWidth, mapHeight)];
  const angles: number[] = [];

  for (const segment of segments) {
    for (const p of [segment.a, segment.b]) {
      const a = Math.atan2(p.y - origin.y, p.x - origin.x);
      angles.push(a - eps, a, a + eps);
    }
  }

  const sweep = adaptiveRaySweep(radius);
  for (let i = 0; i < sweep; i += 1) {
    angles.push((Math.PI * 2 * i) / sweep);
  }

  const hits: Array<Point & { angle: number }> = [];
  for (const angle of angles) {
    let minT = radius;
    for (const segment of segments) {
      const t = raySegmentIntersection(origin, angle, segment);
      if (t !== null && t < minT) {
        minT = t;
      }
    }
    const x = origin.x + Math.cos(angle) * minT;
    const y = origin.y + Math.sin(angle) * minT;
    hits.push({ x, y, angle });
  }

  hits.sort((a, b) => a.angle - b.angle);
  return hits.map((p) => ({ x: p.x, y: p.y }));
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  let j = polygon.length - 1;
  for (let i = 0; i < polygon.length; i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
    j = i;
  }
  return inside;
}
