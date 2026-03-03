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
});
