import { WebSocket, WebSocketServer } from 'ws';
import { addToken, deleteToken, getSnapshot, moveToken, setPortalState, updateToken, upsertScene } from '@/lib/db';
import { parseClientMessage } from '@/lib/wsProtocol';
import type { SceneSettings, TokenRecord, WsServerEvent } from '@/lib/types';

const WS_PORT = Number(process.env.WS_PORT ?? 8787);

type SocketWithSession = WebSocket & { sessionId?: string };

let hub: WebSocketServer | null = null;
const globalKey = '__auvtt_ws_hub__';
let shutdownHooksInstalled = false;

function send(ws: WebSocket, event: WsServerEvent): void {
  ws.send(JSON.stringify(event));
}

function broadcast(sessionId: string, event: WsServerEvent): void {
  if (!hub) return;
  for (const client of hub.clients) {
    const scoped = client as SocketWithSession;
    if (scoped.readyState === WebSocket.OPEN && scoped.sessionId === sessionId) {
      send(client, event);
    }
  }
}

function handleMessage(ws: SocketWithSession, raw: string): void {
  try {
    const incoming = parseClientMessage(JSON.parse(raw));

    if (incoming.type === 'join_session') {
      ws.sessionId = incoming.payload.sessionId;
      const snapshot = getSnapshot(incoming.payload.sessionId);
      if (!snapshot) {
        send(ws, { type: 'error', payload: { message: 'Session not found' } });
        return;
      }
      send(ws, { type: 'session_snapshot', payload: snapshot });
      return;
    }

    const sessionId = incoming.payload.sessionId;
    ws.sessionId = sessionId;

    if (incoming.type === 'add_token') {
      const token = addToken(incoming.payload as TokenRecord);
      broadcast(sessionId, { type: 'token_added', payload: token });
      return;
    }

    if (incoming.type === 'update_token') {
      const token = updateToken(incoming.payload as TokenRecord);
      broadcast(sessionId, { type: 'token_updated', payload: token });
      return;
    }

    if (incoming.type === 'move_token') {
      moveToken(sessionId, incoming.payload.id, incoming.payload.x, incoming.payload.y);
      broadcast(sessionId, {
        type: 'token_moved',
        payload: { id: incoming.payload.id, x: incoming.payload.x, y: incoming.payload.y }
      });
      return;
    }

    if (incoming.type === 'delete_token') {
      deleteToken(sessionId, incoming.payload.id);
      broadcast(sessionId, { type: 'token_deleted', payload: { id: incoming.payload.id } });
      return;
    }

    if (incoming.type === 'update_scene_settings') {
      const scene = upsertScene(incoming.payload as SceneSettings);
      broadcast(sessionId, { type: 'scene_updated', payload: scene });
      return;
    }

    if (incoming.type === 'set_portal_state') {
      const geometry = setPortalState(sessionId, incoming.payload.portalId, incoming.payload.closed);
      if (!geometry) {
        send(ws, { type: 'error', payload: { message: 'Portal not found' } });
        return;
      }
      broadcast(sessionId, { type: 'geometry_updated', payload: geometry });
      return;
    }
  } catch (error) {
    send(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : 'Invalid websocket payload'
      }
    });
  }
}

export function ensureWsHub(): WebSocketServer {
  const globalHub = (globalThis as Record<string, WebSocketServer | undefined>)[globalKey];
  if (globalHub) {
    hub = globalHub;
    return globalHub;
  }

  if (hub) return hub;

  hub = new WebSocketServer({ port: WS_PORT });
  hub.on('connection', (ws) => {
    const scoped = ws as SocketWithSession;
    scoped.on('message', (data) => {
      handleMessage(scoped, String(data));
    });
  });
  hub.on('error', (error) => {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'EADDRINUSE') {
      // Avoid crashing dev server when another process already owns the WS port.
      // Realtime behavior then depends on that external process, which may be stale.
      // eslint-disable-next-line no-console
      console.warn(
        `[auvtt] websocket hub port ${WS_PORT} already in use; stop the existing process or run with a different WS_PORT`
      );
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[auvtt] websocket hub error', error);
  });

  hub.on('listening', () => {
    // eslint-disable-next-line no-console
    console.log(`[auvtt] websocket hub listening on :${WS_PORT}`);
  });

  if (!shutdownHooksInstalled) {
    const closeHub = () => {
      const current = (globalThis as Record<string, WebSocketServer | undefined>)[globalKey];
      if (!current) return;
      for (const client of current.clients) {
        try {
          client.close(1001, 'Server shutting down');
        } catch {
          // no-op
        }
      }
      try {
        current.close();
      } catch {
        // no-op
      }
      delete (globalThis as Record<string, WebSocketServer | undefined>)[globalKey];
      hub = null;
    };

    process.once('SIGINT', closeHub);
    process.once('SIGTERM', closeHub);
    process.once('exit', closeHub);
    shutdownHooksInstalled = true;
  }

  (globalThis as Record<string, WebSocketServer | undefined>)[globalKey] = hub;
  return hub;
}

export function publishSnapshot(sessionId: string): void {
  const snapshot = getSnapshot(sessionId);
  if (!snapshot) return;
  broadcast(sessionId, { type: 'session_snapshot', payload: snapshot });
}

export function publishTokenUpdated(sessionId: string, token: TokenRecord): void {
  broadcast(sessionId, { type: 'token_updated', payload: token });
}
