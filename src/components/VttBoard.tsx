import { useEffect, useMemo, useRef, useState } from 'react';
import type { Point, PortalRecord, SceneSettings, SessionSnapshot, TokenRecord, TokenRole, WsServerEvent } from '@/lib/types';
import {
  hitTestPortal,
  playerVisionCircles,
  pointInPolygon,
  segmentsFromClosedPortals,
  segmentsFromPolylines,
  visibilityPolygonForToken
} from '@/lib/visibility';

interface Props {
  sessionId: string;
  mode: 'dm' | 'viewer';
}

const canvasW = 1200;
const canvasH = 800;

function wsUrl(): string {
  const configured = import.meta.env.PUBLIC_WS_URL;
  if (configured) return configured;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.hostname}:8787`;
}

function id(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `t_${Math.random().toString(36).slice(2, 8)}`;
}

export function VttBoard({ sessionId, mode }: Props) {
  const isDm = mode === 'dm';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapImageRef = useRef<HTMLImageElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const dragTokenRef = useRef<string | null>(null);
  const dragStartRef = useRef<Point | null>(null);
  const didDragRef = useRef(false);
  const visibilityCacheRef = useRef<Map<string, Point[]>>(new Map());

  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('connecting');
  const [uvttImageFile, setUvttImageFile] = useState<File | null>(null);
  const [showDoorOverlays, setShowDoorOverlays] = useState(true);
  const [hoveredPortalId, setHoveredPortalId] = useState<string | null>(null);

  const selectedToken = useMemo(
    () => snapshot?.tokens.find((token) => token.id === selectedId) ?? null,
    [snapshot, selectedId]
  );
  const portals = useMemo<PortalRecord[]>(() => snapshot?.geometry.portals ?? [], [snapshot]);
  const wallSegments = useMemo(() => segmentsFromPolylines(snapshot?.geometry.lineOfSight ?? []), [snapshot]);
  const closedPortalSegments = useMemo(() => segmentsFromClosedPortals(portals), [portals]);
  const blockingSegments = useMemo(() => [...wallSegments, ...closedPortalSegments], [wallSegments, closedPortalSegments]);
  const doorCounts = useMemo(
    () => ({
      closed: portals.filter((portal) => portal.closed).length,
      open: portals.filter((portal) => !portal.closed).length
    }),
    [portals]
  );
  const geometryRevision = useMemo(() => {
    if (!snapshot) return 'none';
    return JSON.stringify({
      lineOfSight: snapshot.geometry.lineOfSight,
      portals: portals.map((portal) => [portal.id, portal.a.x, portal.a.y, portal.b.x, portal.b.y, portal.closed])
    });
  }, [snapshot, portals]);

  useEffect(() => {
    let cancelled = false;

    async function loadSnapshot() {
      const response = await fetch(`/api/sessions/${sessionId}`);
      if (!response.ok) {
        throw new Error('Session not found');
      }
      const data = (await response.json()) as SessionSnapshot;
      if (!cancelled) {
        setSnapshot(data);
      }
    }

    loadSnapshot().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load session'));

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      ws.send(JSON.stringify({ type: 'join_session', payload: { sessionId, role: mode } }));
    };

    ws.onerror = () => {
      setStatus('error');
      setError('Realtime connection failed');
    };

    ws.onclose = () => {
      setStatus('disconnected');
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as WsServerEvent;
      setSnapshot((current) => {
        if (msg.type === 'session_snapshot') return msg.payload;
        if (!current) return current;

        if (msg.type === 'token_added') {
          return { ...current, tokens: [...current.tokens, msg.payload] };
        }
        if (msg.type === 'token_updated') {
          return {
            ...current,
            tokens: current.tokens.map((t) => (t.id === msg.payload.id ? msg.payload : t))
          };
        }
        if (msg.type === 'token_moved') {
          return {
            ...current,
            tokens: current.tokens.map((t) =>
              t.id === msg.payload.id ? { ...t, x: msg.payload.x, y: msg.payload.y } : t
            )
          };
        }
        if (msg.type === 'token_deleted') {
          return { ...current, tokens: current.tokens.filter((t) => t.id !== msg.payload.id) };
        }
        if (msg.type === 'scene_updated') {
          return { ...current, scene: msg.payload };
        }
        if (msg.type === 'geometry_updated') {
          return { ...current, geometry: msg.payload };
        }
        if (msg.type === 'error') {
          setError(msg.payload.message);
          return current;
        }

        return current;
      });
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId, mode]);

  useEffect(() => {
    visibilityCacheRef.current.clear();
  }, [geometryRevision, snapshot?.map?.width, snapshot?.map?.height]);

  useEffect(() => {
    const map = snapshot?.map;
    if (!map || !map.imageUrl) {
      mapImageRef.current = null;
      return;
    }
    const img = new Image();
    img.src = map.imageUrl;
    img.onload = () => {
      mapImageRef.current = img;
      setError((current) =>
        current?.startsWith('Map image reference in imported UVTT could not be loaded') ? null : current
      );
      draw();
    };
    img.onerror = () => {
      mapImageRef.current = null;
      setError('Map image reference in imported UVTT could not be loaded. Upload the map image separately.');
      draw();
    };
  }, [snapshot?.map?.imageUrl]);

  function send(payload: unknown) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  }

  function addToken(role: TokenRole) {
    if (!isDm || !snapshot) return;
    const token: TokenRecord = {
      id: id(),
      sessionId,
      name: role === 'player' ? 'Player' : role === 'npc' ? 'NPC' : 'Marker',
      x: (snapshot.map?.width ?? canvasW) / 2,
      y: (snapshot.map?.height ?? canvasH) / 2,
      size: 36,
      role,
      vision: {
        enabled: role === 'player',
        radius: 150,
        shape: 'circle'
      },
      visible: true
    };
    send({ type: 'add_token', payload: token });
  }

  function updateToken(token: TokenRecord) {
    send({ type: 'update_token', payload: token });
  }

  function updateScene(scene: SceneSettings) {
    send({ type: 'update_scene_settings', payload: scene });
  }

  function canvasPoint(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const scaleX = (snapshot?.map?.width ?? canvasW) / rect.width;
    const scaleY = (snapshot?.map?.height ?? canvasH) / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  }

  function doorHitThreshold(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    const mapW = snapshot?.map?.width ?? canvasW;
    const mapH = snapshot?.map?.height ?? canvasH;
    const scale = (mapW / rect.width + mapH / rect.height) / 2;
    return 10 * scale;
  }

  function hitToken(x: number, y: number): TokenRecord | null {
    if (!snapshot) return null;
    for (let i = snapshot.tokens.length - 1; i >= 0; i -= 1) {
      const token = snapshot.tokens[i];
      const dx = x - token.x;
      const dy = y - token.y;
      if (Math.sqrt(dx * dx + dy * dy) <= token.size / 2) {
        return token;
      }
    }
    return null;
  }

  function onMouseDown(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
    const pt = canvasPoint(event);
    dragStartRef.current = pt;
    didDragRef.current = false;
    const token = hitToken(pt.x, pt.y);
    setSelectedId(token?.id ?? null);
    if (isDm && token) {
      dragTokenRef.current = token.id;
    }
  }

  function onMouseMove(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
    const pt = canvasPoint(event);
    const start = dragStartRef.current;
    if (start) {
      const dx = pt.x - start.x;
      const dy = pt.y - start.y;
      if (dx * dx + dy * dy > 9) didDragRef.current = true;
    }

    if (!isDm) return;
    if (dragTokenRef.current) {
      send({ type: 'move_token', payload: { sessionId, id: dragTokenRef.current, x: pt.x, y: pt.y } });
      return;
    }

    if (!showDoorOverlays || portals.length === 0) {
      if (hoveredPortalId !== null) setHoveredPortalId(null);
      return;
    }
    const hovered = hitTestPortal(pt, portals, doorHitThreshold(event));
    if (hovered !== hoveredPortalId) {
      setHoveredPortalId(hovered);
    }
  }

  function onMouseUp(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
    const pt = canvasPoint(event);
    if (isDm && !dragTokenRef.current && !didDragRef.current && showDoorOverlays && portals.length > 0) {
      const portalId = hitTestPortal(pt, portals, doorHitThreshold(event));
      if (portalId) {
        const portal = portals.find((entry) => entry.id === portalId);
        if (portal) {
          send({
            type: 'set_portal_state',
            payload: { sessionId, portalId, closed: !portal.closed }
          });
        }
      }
    }
    dragTokenRef.current = null;
    dragStartRef.current = null;
    didDragRef.current = false;
  }

  function onMouseLeave() {
    dragTokenRef.current = null;
    dragStartRef.current = null;
    didDragRef.current = false;
    setHoveredPortalId(null);
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas || !snapshot) return;

    const mapW = snapshot.map?.width ?? canvasW;
    const mapH = snapshot.map?.height ?? canvasH;
    canvas.width = mapW;
    canvas.height = mapH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, mapW, mapH);

    const img = mapImageRef.current;
    const shouldMask = !isDm && snapshot.scene.fogEnabled && !snapshot.scene.globalLight;
    const circles = playerVisionCircles(snapshot.tokens);
    const visionPolygons = circles.map((circle) => {
      const key = `${geometryRevision}|${mapW}|${mapH}|${circle.x.toFixed(2)}|${circle.y.toFixed(2)}|${circle.radius.toFixed(2)}`;
      const cached = visibilityCacheRef.current.get(key);
      if (cached) return cached;
      const polygon = visibilityPolygonForToken({ x: circle.x, y: circle.y }, circle.radius, blockingSegments, mapW, mapH);
      visibilityCacheRef.current.set(key, polygon);
      return polygon;
    });

    if (shouldMask) {
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fillRect(0, 0, mapW, mapH);

      if (circles.length > 0) {
        for (const polygon of visionPolygons) {
          if (polygon.length < 3) continue;

          ctx.save();
          ctx.beginPath();
          ctx.moveTo(polygon[0].x, polygon[0].y);
          for (let i = 1; i < polygon.length; i += 1) {
            ctx.lineTo(polygon[i].x, polygon[i].y);
          }
          ctx.closePath();
          ctx.clip();
          if (img) {
            ctx.drawImage(img, 0, 0, mapW, mapH);
          } else {
            ctx.fillStyle = '#e9dfcf';
            ctx.fillRect(0, 0, mapW, mapH);
            ctx.fillStyle = '#6e5b44';
            ctx.fillText('Upload a map to begin', 20, 30);
          }
          ctx.restore();
        }
      }
    } else if (img) {
      ctx.drawImage(img, 0, 0, mapW, mapH);
    } else {
      ctx.fillStyle = '#e9dfcf';
      ctx.fillRect(0, 0, mapW, mapH);
      ctx.fillStyle = '#6e5b44';
      ctx.fillText('Upload a map to begin', 20, 30);
    }

    for (const token of snapshot.tokens) {
      if (!isDm && !token.visible) continue;
      if (!isDm && token.role === 'dm_marker') continue;
      if (!isDm && token.role === 'npc') {
        const visibleByLos = visionPolygons.some((poly) => pointInPolygon({ x: token.x, y: token.y }, poly));
        if (!visibleByLos) continue;
      }

      ctx.beginPath();
      ctx.arc(token.x, token.y, token.size / 2, 0, Math.PI * 2);
      ctx.fillStyle = token.role === 'player' ? '#287f77' : token.role === 'npc' ? '#a84b36' : '#5e4f87';
      ctx.fill();

      if (isDm && token.vision.enabled) {
        ctx.beginPath();
        ctx.arc(token.x, token.y, token.vision.radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(40,127,119,0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      if (token.id === selectedId) {
        ctx.beginPath();
        ctx.arc(token.x, token.y, token.size / 2 + 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#f7f7f7';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    if (isDm && showDoorOverlays && portals.length > 0) {
      for (const portal of portals) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(portal.a.x, portal.a.y);
        ctx.lineTo(portal.b.x, portal.b.y);
        ctx.lineWidth = portal.id === hoveredPortalId ? 5 : 3;
        ctx.strokeStyle = portal.closed ? '#da5d2a' : '#2a9d6c';
        if (!portal.closed) {
          ctx.setLineDash([8, 6]);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  useEffect(() => {
    draw();
  }, [snapshot, selectedId, hoveredPortalId, showDoorOverlays, geometryRevision, blockingSegments]);

  async function uploadMap(file: File, width: number, height: number, gridSize: number | null) {
    const data = new FormData();
    data.append('map', file);
    data.append('width', String(width));
    data.append('height', String(height));
    if (gridSize) data.append('gridSize', String(gridSize));

    const response = await fetch(`/api/sessions/${sessionId}/map`, {
      method: 'POST',
      body: data
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error ?? 'Map upload failed');
    }
    const payload = await response.json();
    setSnapshot((current) => (current ? { ...current, map: payload.map } : current));
    return payload.map as { imageUrl: string; width: number; height: number; gridSize: number | null };
  }

  async function importUvtt(file: File) {
    const text = await file.text();
    const raw = JSON.parse(text) as {
      image?: string;
      resolution?: {
        map_size?: { x?: number; y?: number };
        pixels_per_grid?: number;
      };
    };

    if (uvttImageFile) {
      const width = Math.round(raw.resolution?.map_size?.x ?? snapshot?.map?.width ?? canvasW);
      const height = Math.round(raw.resolution?.map_size?.y ?? snapshot?.map?.height ?? canvasH);
      const grid = Math.round(raw.resolution?.pixels_per_grid ?? snapshot?.map?.gridSize ?? 70);
      const uploaded = await uploadMap(uvttImageFile, width, height, Number.isFinite(grid) ? grid : null);
      raw.image = uploaded.imageUrl;
    }

    const response = await fetch(`/api/sessions/${sessionId}/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(raw)
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error ?? 'Import failed');
    }
    const payload = (await response.json()) as SessionSnapshot;
    setSnapshot(payload);

    const imageRef = raw.image?.trim() ?? '';
    const looksRelative = Boolean(
      imageRef &&
        !imageRef.startsWith('/') &&
        !imageRef.startsWith('http://') &&
        !imageRef.startsWith('https://') &&
        !imageRef.startsWith('data:image/')
    );
    if (looksRelative) {
      setError('UVTT imported. This file references a separate map image; choose it in \"Companion UVTT image\" and re-import.');
    }
  }

  async function copyPlayerUrl() {
    let host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      try {
        const response = await fetch('/api/network');
        if (response.ok) {
          const payload = (await response.json()) as { lanIp?: string | null };
          if (payload.lanIp) {
            host = payload.lanIp;
          }
        }
      } catch {
        // Fall back to current host when LAN IP discovery fails.
      }
    }

    const port = location.port ? `:${location.port}` : '';
    const url = `${location.protocol}//${host}${port}/view/${sessionId}`;
    navigator.clipboard.writeText(url).catch(() => undefined);
  }

  if (!snapshot) {
    return <p>Loading board…</p>;
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="panel" style={{ padding: 12 }}>
        <strong>{snapshot.session.name}</strong> · Session `{snapshot.session.id}` · WS: {status}
      </div>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: isDm ? '1fr 300px' : '1fr' }}>
        <section className="panel" style={{ padding: 12, overflow: 'auto' }}>
          <canvas
            ref={canvasRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave}
            style={{ width: '100%', maxWidth: 1000, display: 'block', borderRadius: 8 }}
          />
        </section>

        {isDm && (
          <aside className="panel" style={{ padding: 12, display: 'grid', gap: 10, alignContent: 'start' }}>
            <strong>DM Controls</strong>
            <button onClick={() => addToken('player')}>Add Player Token</button>
            <button onClick={() => addToken('npc')}>Add NPC Token</button>
            <button onClick={() => addToken('dm_marker')}>Add DM Marker</button>
            <button onClick={copyPlayerUrl}>Copy Player URL</button>
            <a href={`/api/sessions/${sessionId}/export`} target="_blank" rel="noreferrer">
              Export .dd2vtt
            </a>

            <label>
              Upload Map
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const width = Number(prompt('Map width in px', String(snapshot.map?.width ?? canvasW)) ?? canvasW);
                    const height = Number(prompt('Map height in px', String(snapshot.map?.height ?? canvasH)) ?? canvasH);
                    const gridValue = prompt('Grid size (optional)', snapshot.map?.gridSize?.toString() ?? '');
                    const gridSize = gridValue ? Number(gridValue) : null;
                    await uploadMap(file, width, height, gridSize);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Map upload failed');
                  }
                }}
              />
            </label>

            <label>
              Companion UVTT image (optional)
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  setUvttImageFile(e.target.files?.[0] ?? null);
                }}
              />
            </label>

            <label>
              Import .dd2vtt / .uvtt
              <input
                type="file"
                accept="application/json,.json,.uvtt,.dd2vtt"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    await importUvtt(file);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Import failed');
                  }
                }}
              />
            </label>

            <label>
              <input
                type="checkbox"
                checked={snapshot.scene.fogEnabled}
                onChange={(e) => updateScene({ ...snapshot.scene, fogEnabled: e.target.checked })}
              />{' '}
              Fog enabled
            </label>
            <label>
              <input
                type="checkbox"
                checked={snapshot.scene.globalLight}
                onChange={(e) => updateScene({ ...snapshot.scene, globalLight: e.target.checked })}
              />{' '}
              Global light
            </label>
            <label>
              <input
                type="checkbox"
                checked={showDoorOverlays}
                onChange={(e) => setShowDoorOverlays(e.target.checked)}
              />{' '}
              Show door overlays
            </label>
            <div>Doors: {doorCounts.closed} closed / {doorCounts.open} open</div>

            {selectedToken && (
              <div style={{ borderTop: '1px solid #e4dccb', paddingTop: 8, display: 'grid', gap: 8 }}>
                <strong>Token</strong>
                <input
                  value={selectedToken.name}
                  onChange={(e) => updateToken({ ...selectedToken, name: e.target.value })}
                />
                <select
                  value={selectedToken.role}
                  onChange={(e) => updateToken({ ...selectedToken, role: e.target.value as TokenRole })}
                >
                  <option value="player">Player</option>
                  <option value="npc">NPC</option>
                  <option value="dm_marker">DM Marker</option>
                </select>
                <label>
                  Size
                  <input
                    type="number"
                    min={8}
                    value={selectedToken.size}
                    onChange={(e) => updateToken({ ...selectedToken, size: Number(e.target.value) })}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedToken.vision.enabled}
                    onChange={(e) =>
                      updateToken({
                        ...selectedToken,
                        vision: { ...selectedToken.vision, enabled: e.target.checked }
                      })
                    }
                  />{' '}
                  Vision enabled
                </label>
                <label>
                  Vision radius
                  <input
                    type="number"
                    min={0}
                    value={selectedToken.vision.radius}
                    onChange={(e) =>
                      updateToken({
                        ...selectedToken,
                        vision: { ...selectedToken.vision, radius: Number(e.target.value) }
                      })
                    }
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedToken.visible}
                    onChange={(e) => updateToken({ ...selectedToken, visible: e.target.checked })}
                  />{' '}
                  Visible
                </label>
                <button onClick={() => send({ type: 'delete_token', payload: { sessionId, id: selectedToken.id } })}>
                  Delete Token
                </button>
              </div>
            )}

            {error && <p style={{ color: '#a12121' }}>{error}</p>}
          </aside>
        )}
      </div>
    </div>
  );
}
