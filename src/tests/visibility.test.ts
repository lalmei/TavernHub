import { describe, expect, it } from 'vitest';
import {
  adaptiveRaySweep,
  hitTestPortal,
  normalizePortals,
  playerVisionCircles,
  pointInPolygon,
  pointVisible,
  segmentsFromClosedPortals,
  segmentsFromPolylines,
  visibilityPolygonForToken
} from '@/lib/visibility';
import type { TokenRecord } from '@/lib/types';

describe('visibility helpers', () => {
  it('returns circles for visible player tokens with enabled vision', () => {
    const tokens: TokenRecord[] = [
      {
        id: '1',
        sessionId: 's',
        name: 'Player A',
        x: 10,
        y: 10,
        size: 32,
        role: 'player',
        vision: { enabled: true, radius: 100, shape: 'circle' },
        visible: true
      },
      {
        id: '2',
        sessionId: 's',
        name: 'NPC',
        x: 100,
        y: 50,
        size: 32,
        role: 'npc',
        vision: { enabled: true, radius: 100, shape: 'circle' },
        visible: true
      }
    ];

    const circles = playerVisionCircles(tokens);
    expect(circles).toHaveLength(1);
    expect(pointVisible(20, 20, circles)).toBe(true);
    expect(pointVisible(300, 300, circles)).toBe(false);
  });

  it('builds wall segments and clamps LOS by wall intersections', () => {
    const segments = segmentsFromPolylines([
      [
        { x: 120, y: 40 },
        { x: 120, y: 160 }
      ]
    ]);
    const poly = visibilityPolygonForToken({ x: 60, y: 100 }, 120, segments, 300, 300);

    const midlineHit = poly
      .filter((p) => p.x >= 60)
      .reduce((best, p) => (Math.abs(p.y - 100) < Math.abs(best.y - 100) ? p : best), poly[0]);
    expect(midlineHit.x).toBeLessThan(121);
    expect(poly.length).toBeGreaterThan(30);
  });

  it('normalizes portal bounds variants and defaults closed to true', () => {
    const portals = normalizePortals([
      { bounds: [10, 20, 30, 40], closed: false },
      { bounds: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
      { id: 'door', bounds: [50, 60, 80, 60] },
      { id: 'door', bounds: [80, 80, 80, 80] }
    ]);

    expect(portals).toHaveLength(3);
    expect(portals[0].closed).toBe(false);
    expect(portals[1].closed).toBe(true);
    expect(portals[2].id).toBe('door');
  });

  it('uses only closed portals as blocking segments', () => {
    const portals = normalizePortals([
      { id: 'a', bounds: [0, 0, 100, 0], closed: true },
      { id: 'b', bounds: [0, 10, 100, 10], closed: false }
    ]);

    const segments = segmentsFromClosedPortals(portals);
    expect(segments).toHaveLength(1);
    expect(segments[0].a.y).toBe(0);
  });

  it('supports portal hit testing by distance threshold', () => {
    const portals = normalizePortals([{ id: 'a', bounds: [0, 0, 100, 0], closed: true }]);
    const id = hitTestPortal({ x: 50, y: 6 }, portals, 8);
    expect(id).toBe('a');
    expect(hitTestPortal({ x: 50, y: 20 }, portals, 8)).toBeNull();
  });

  it('increases adaptive ray sweep for larger vision radii', () => {
    expect(adaptiveRaySweep(50)).toBeGreaterThanOrEqual(180);
    expect(adaptiveRaySweep(800)).toBeGreaterThan(adaptiveRaySweep(50));
    expect(adaptiveRaySweep(10000)).toBeLessThanOrEqual(720);
  });

  it('detects point inclusion in visibility polygon', () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ];
    expect(pointInPolygon({ x: 50, y: 50 }, polygon)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 50 }, polygon)).toBe(false);
  });
});
