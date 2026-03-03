import { describe, expect, it } from 'vitest';
import { createSession, exportUniversalVtt, importUniversalVtt, setPortalState } from '@/lib/db';

describe('portal import/export persistence', () => {
  it('normalizes, scales, and persists portal closed state changes', () => {
    const session = createSession('Portal Persistence Test');
    const snapshot = importUniversalVtt(session.id, {
      format: 0.3,
      resolution: {
        map_origin: { x: 0, y: 0 },
        map_size: { x: 20, y: 10 },
        pixels_per_grid: 70
      },
      line_of_sight: [],
      portals: [
        {
          bounds: [1, 2, 3, 2],
          closed: false
        }
      ],
      lights: []
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.geometry.portals).toHaveLength(1);
    expect(snapshot?.geometry.portals[0].a.x).toBe(70);
    expect(snapshot?.geometry.portals[0].closed).toBe(false);

    const updated = setPortalState(session.id, snapshot!.geometry.portals[0].id, true);
    expect(updated?.portals[0].closed).toBe(true);

    const exported = exportUniversalVtt(session.id);
    expect(exported).not.toBeNull();
    expect(exported?.portals[0].closed).toBe(true);
  });
});
