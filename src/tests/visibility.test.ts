import { describe, expect, it } from 'vitest';
import { playerVisionCircles, pointVisible } from '@/lib/visibility';
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
});
