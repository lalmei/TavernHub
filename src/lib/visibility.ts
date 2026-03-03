import type { TokenRecord } from '@/lib/types';

export interface Circle {
  x: number;
  y: number;
  radius: number;
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
