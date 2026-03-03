import { describe, expect, it } from 'vitest';
import { parseClientMessage } from '@/lib/wsProtocol';

describe('ws protocol parser', () => {
  it('parses move_token messages', () => {
    const payload = parseClientMessage({
      type: 'move_token',
      payload: { sessionId: 's1', id: 't1', x: 10, y: 20 }
    });

    expect(payload.type).toBe('move_token');
    expect(payload.payload.x).toBe(10);
  });

  it('throws for malformed message payloads', () => {
    expect(() =>
      parseClientMessage({
        type: 'move_token',
        payload: { sessionId: 's1', id: '', x: 'a', y: 20 }
      })
    ).toThrow();
  });

  it('parses set_portal_state messages', () => {
    const payload = parseClientMessage({
      type: 'set_portal_state',
      payload: { sessionId: 's1', portalId: 'portal_1', closed: true }
    });

    expect(payload.type).toBe('set_portal_state');
    expect(payload.payload.portalId).toBe('portal_1');
    expect(payload.payload.closed).toBe(true);
  });

  it('parses add_token messages with imageUrl', () => {
    const payload = parseClientMessage({
      type: 'add_token',
      payload: {
        id: 't1',
        sessionId: 's1',
        name: 'Scout',
        x: 10,
        y: 20,
        size: 32,
        role: 'player',
        vision: { enabled: true, radius: 120, shape: 'circle' },
        visible: true,
        imageUrl: null
      }
    });

    expect(payload.type).toBe('add_token');
    expect(payload.payload.imageUrl).toBeNull();
  });
});
