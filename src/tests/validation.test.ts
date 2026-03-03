import { describe, expect, it } from 'vitest';
import { universalVttSchema } from '@/lib/validation';

describe('vtt schema validation', () => {
  it('accepts a valid universal vtt payload', () => {
    const payload = {
      format: 0.3,
      resolution: {
        map_origin: { x: 0, y: 0 },
        map_size: { x: 1200, y: 800 },
        pixels_per_grid: 70
      },
      image: '/uploads/map.png',
      line_of_sight: [],
      portals: [],
      lights: [],
      extensions: {
        auvtt: {
          scene: {
            fogEnabled: true,
            globalLight: false
          },
          tokens: [
            {
              id: 't1',
              name: 'Rogue',
              x: 100,
              y: 100,
              size: 32,
              role: 'player',
              vision: {
                enabled: true,
                radius: 180,
                shape: 'circle'
              },
              visible: true,
              imageUrl: '/uploads/rogue.png'
            }
          ]
        }
      }
    };

    const parsed = universalVttSchema.parse(payload);
    expect(parsed.format).toBe(0.3);
    expect(parsed.extensions?.auvtt?.tokens?.[0].vision.radius).toBe(180);
  });

  it('rejects invalid formats', () => {
    expect(() =>
      universalVttSchema.parse({
        format: 9,
        resolution: {
          map_origin: { x: 0, y: 0 },
          map_size: { x: 1200, y: 800 },
          pixels_per_grid: 70
        },
        line_of_sight: [],
        portals: [],
        lights: []
      })
    ).toThrow();
  });

  it('accepts dungeon alchemist style portal bounds', () => {
    const payload = {
      format: 0.3,
      resolution: {
        map_origin: { x: 0, y: 0 },
        map_size: { x: 1200, y: 800 },
        pixels_per_grid: 70
      },
      line_of_sight: [],
      portals: [
        {
          bounds: [
            { x: 100, y: 200 },
            { x: 140, y: 200 }
          ],
          closed: false
        }
      ],
      lights: []
    };

    expect(() => universalVttSchema.parse(payload)).not.toThrow();
  });
});
