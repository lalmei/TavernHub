import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
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

function roleColor(role: TokenRole): string {
  if (role === 'player') return '#22c1a1';
  if (role === 'npc') return '#fb6f52';
  return '#6f7ef2';
}

function roleLabel(role: TokenRole): string {
  if (role === 'dm_marker') return 'DM Marker';
  return role.toUpperCase();
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
  const tokenImageCacheRef = useRef<Map<string, HTMLImageElement | null>>(new Map());

  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('connecting');
  const [showDoorOverlays, setShowDoorOverlays] = useState(true);
  const [hoveredPortalId, setHoveredPortalId] = useState<string | null>(null);

  const [mapFile, setMapFile] = useState<File | null>(null);
  const [mapWidth, setMapWidth] = useState(String(canvasW));
  const [mapHeight, setMapHeight] = useState(String(canvasH));
  const [mapGridSize, setMapGridSize] = useState('');
  const [uvttFile, setUvttFile] = useState<File | null>(null);

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

  useEffect(() => {
    if (!snapshot) return;
    setMapWidth(String(snapshot.map?.width ?? canvasW));
    setMapHeight(String(snapshot.map?.height ?? canvasH));
    setMapGridSize(snapshot.map?.gridSize ? String(snapshot.map.gridSize) : '');
  }, [snapshot?.map?.width, snapshot?.map?.height, snapshot?.map?.gridSize, snapshot]);

  function ensureTokenImage(url: string): HTMLImageElement | null {
    const cached = tokenImageCacheRef.current.get(url);
    if (cached !== undefined) return cached;

    tokenImageCacheRef.current.set(url, null);
    const img = new Image();
    img.src = url;
    img.onload = () => {
      tokenImageCacheRef.current.set(url, img);
      draw();
    };
    img.onerror = () => {
      tokenImageCacheRef.current.set(url, null);
      draw();
    };

    return null;
  }

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
      visible: true,
      imageUrl: null
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
            ctx.fillStyle = '#171717';
            ctx.fillRect(0, 0, mapW, mapH);
            ctx.fillStyle = '#adadad';
            ctx.fillText('Upload a map to begin', 20, 30);
          }
          ctx.restore();
        }
      }
    } else if (img) {
      ctx.drawImage(img, 0, 0, mapW, mapH);
    } else {
      ctx.fillStyle = '#171717';
      ctx.fillRect(0, 0, mapW, mapH);
      ctx.fillStyle = '#adadad';
      ctx.fillText('Upload a map to begin', 20, 30);
    }

    for (const token of snapshot.tokens) {
      if (!isDm && !token.visible) continue;
      if (!isDm && token.role === 'dm_marker') continue;
      if (!isDm && token.role === 'npc') {
        const visibleByLos = visionPolygons.some((poly) => pointInPolygon({ x: token.x, y: token.y }, poly));
        if (!visibleByLos) continue;
      }

      ctx.save();
      ctx.beginPath();
      ctx.arc(token.x, token.y, token.size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      const portrait = token.imageUrl ? ensureTokenImage(token.imageUrl) : null;
      if (portrait) {
        const size = token.size;
        const src = Math.min(portrait.naturalWidth, portrait.naturalHeight);
        const sx = (portrait.naturalWidth - src) / 2;
        const sy = (portrait.naturalHeight - src) / 2;
        ctx.drawImage(portrait, sx, sy, src, src, token.x - size / 2, token.y - size / 2, size, size);
      } else {
        ctx.fillStyle = roleColor(token.role);
        ctx.fill();
      }
      ctx.restore();

      ctx.beginPath();
      ctx.arc(token.x, token.y, token.size / 2 - 1, 0, Math.PI * 2);
      ctx.strokeStyle = roleColor(token.role);
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(token.x, token.y, token.size / 2 + 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(5,5,5,0.95)';
      ctx.lineWidth = 2;
      ctx.stroke();

      if (isDm && token.vision.enabled) {
        ctx.beginPath();
        ctx.arc(token.x, token.y, token.vision.radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(245,245,245,0.32)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      if (token.id === selectedId) {
        ctx.beginPath();
        ctx.arc(token.x, token.y, token.size / 2 + 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }

    if (isDm && showDoorOverlays && portals.length > 0) {
      for (const portal of portals) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(portal.a.x, portal.a.y);
        ctx.lineTo(portal.b.x, portal.b.y);
        ctx.lineWidth = portal.id === hoveredPortalId ? 6 : 4;
        ctx.strokeStyle = portal.id === hoveredPortalId ? '#ffffff' : portal.closed ? '#da5d2a' : '#2a9d6c';
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
      setError('UVTT imported. This file references a separate map image; use Upload Map to attach it.');
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

  async function uploadSelectedTokenImage(file: File) {
    if (!selectedToken) return;
    const data = new FormData();
    data.append('image', file);

    const response = await fetch(`/api/sessions/${sessionId}/tokens/${selectedToken.id}/image`, {
      method: 'POST',
      body: data
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? 'Image upload failed');
    }
    const token = payload.token as TokenRecord;
    setSnapshot((current) =>
      current
        ? {
            ...current,
            tokens: current.tokens.map((entry) => (entry.id === token.id ? token : entry))
          }
        : current
    );
  }

  async function removeSelectedTokenImage() {
    if (!selectedToken) return;
    const response = await fetch(`/api/sessions/${sessionId}/tokens/${selectedToken.id}/image`, {
      method: 'DELETE'
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? 'Failed to remove image');
    }
    const token = payload.token as TokenRecord;
    setSnapshot((current) =>
      current
        ? {
            ...current,
            tokens: current.tokens.map((entry) => (entry.id === token.id ? token : entry))
          }
        : current
    );
  }

  const viewerVisibleTokenIds = useMemo(() => {
    if (!snapshot || isDm) return new Set<string>();
    const mapW = snapshot.map?.width ?? canvasW;
    const mapH = snapshot.map?.height ?? canvasH;
    const circles = playerVisionCircles(snapshot.tokens);
    const polygons = circles.map((circle) =>
      visibilityPolygonForToken({ x: circle.x, y: circle.y }, circle.radius, blockingSegments, mapW, mapH)
    );

    const visible = new Set<string>();
    for (const token of snapshot.tokens) {
      if (!token.visible) continue;
      if (token.role === 'dm_marker') continue;
      if (token.role === 'npc' && polygons.length > 0) {
        const visibleByLos = polygons.some((poly) => pointInPolygon({ x: token.x, y: token.y }, poly));
        if (!visibleByLos) continue;
      }
      if (token.role === 'npc' && polygons.length === 0) continue;
      visible.add(token.id);
    }
    return visible;
  }, [snapshot, isDm, blockingSegments]);

  const rosterTokens = useMemo(() => {
    if (!snapshot) return [] as TokenRecord[];
    if (isDm) return snapshot.tokens;
    return snapshot.tokens.filter((token) => viewerVisibleTokenIds.has(token.id));
  }, [snapshot, isDm, viewerVisibleTokenIds]);

  if (!snapshot) {
    return <p>Loading board...</p>;
  }

  return (
    <div className="ui-grid" style={{ gap: 14 }}>
      <Card>
        <CardContent>
          <div className="row-inline">
            <div>
              <strong>{snapshot.session.name}</strong>
              <p className="token-sub">Session `{snapshot.session.id}`</p>
            </div>
            <Badge>WS: {status}</Badge>
          </div>
        </CardContent>
      </Card>

      <div className={`board-layout ${isDm ? 'board-layout--dm' : 'board-layout--viewer'}`}>
        {!isDm && (
          <aside className="sidebar">
            <Card>
              <CardHeader>
                <CardTitle>Tokens in Scene</CardTitle>
                <CardDescription>Visible token roster</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea>
                  <div className="ui-grid">
                    {rosterTokens.map((token) => (
                      <button
                        key={token.id}
                        className={`token-row ${selectedId === token.id ? 'is-selected' : ''}`}
                        onClick={() => setSelectedId(token.id)}
                      >
                        {token.imageUrl ? (
                          <img src={token.imageUrl} alt={`${token.name} portrait`} className="token-thumb" />
                        ) : (
                          <span className="token-thumb token-fallback">{token.name.slice(0, 2).toUpperCase()}</span>
                        )}
                        <span className="token-meta">
                          <span className="token-name">{token.name}</span>
                          <span className="token-sub">{roleLabel(token.role)}</span>
                        </span>
                        <Badge>{token.visible ? 'shown' : 'hidden'}</Badge>
                      </button>
                    ))}
                    {rosterTokens.length === 0 && <p className="token-sub">No visible tokens yet.</p>}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </aside>
        )}

        <section className="ui-card canvas-wrap">
          <canvas
            ref={canvasRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave}
            className="vtt-canvas"
          />
        </section>

        {isDm && (
          <aside className="sidebar">
            <Card>
              <CardHeader>
                <CardTitle>DM Controls</CardTitle>
                <CardDescription>Scene actions and export tools</CardDescription>
              </CardHeader>
              <CardContent className="ui-grid">
                <Button onClick={() => addToken('player')}>Add Player Token</Button>
                <Button onClick={() => addToken('npc')} variant="outline">
                  Add NPC Token
                </Button>
                <Button onClick={() => addToken('dm_marker')} variant="outline">
                  Add DM Marker
                </Button>
                <Button onClick={copyPlayerUrl} variant="ghost">
                  Copy Player URL
                </Button>
                <a href={`/api/sessions/${sessionId}/export`} target="_blank" rel="noreferrer">
                  Export .dd2vtt
                </a>

                <Separator />

                <label className="ui-label" htmlFor="map-upload">
                  Upload map image
                  <Input
                    id="map-upload"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => setMapFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <div className="ui-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <label className="ui-label" htmlFor="map-width">
                    Width (px)
                    <Input id="map-width" type="number" min={1} value={mapWidth} onChange={(e) => setMapWidth(e.target.value)} />
                  </label>
                  <label className="ui-label" htmlFor="map-height">
                    Height (px)
                    <Input
                      id="map-height"
                      type="number"
                      min={1}
                      value={mapHeight}
                      onChange={(e) => setMapHeight(e.target.value)}
                    />
                  </label>
                </div>
                <label className="ui-label" htmlFor="map-grid-size">
                  Grid size (optional)
                  <Input
                    id="map-grid-size"
                    type="number"
                    min={1}
                    value={mapGridSize}
                    onChange={(e) => setMapGridSize(e.target.value)}
                  />
                </label>
                <Button
                  variant="outline"
                  onClick={async () => {
                    if (!mapFile) {
                      setError('Select a map image first.');
                      return;
                    }
                    try {
                      await uploadMap(
                        mapFile,
                        Number(mapWidth || canvasW),
                        Number(mapHeight || canvasH),
                        mapGridSize ? Number(mapGridSize) : null
                      );
                      setMapFile(null);
                      setError(null);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Map upload failed');
                    }
                  }}
                >
                  Upload Map
                </Button>

                <label className="ui-label" htmlFor="uvtt-upload">
                  Import .dd2vtt / .uvtt
                  <Input
                    id="uvtt-upload"
                    type="file"
                    accept="application/json,.json,.uvtt,.dd2vtt"
                    onChange={(e) => setUvttFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <Button
                  variant="outline"
                  onClick={async () => {
                    if (!uvttFile) {
                      setError('Select a .uvtt/.dd2vtt file first.');
                      return;
                    }
                    try {
                      await importUvtt(uvttFile);
                      setUvttFile(null);
                      setError(null);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Import failed');
                    }
                  }}
                >
                  Import VTT
                </Button>

                <Separator />

                <label className="ui-check-row">
                  <Checkbox
                    checked={snapshot.scene.fogEnabled}
                    onChange={(e) => updateScene({ ...snapshot.scene, fogEnabled: e.target.checked })}
                  />
                  Fog enabled
                </label>
                <label className="ui-check-row">
                  <Checkbox
                    checked={snapshot.scene.globalLight}
                    onChange={(e) => updateScene({ ...snapshot.scene, globalLight: e.target.checked })}
                  />
                  Global light
                </label>
                <label className="ui-check-row">
                  <Checkbox checked={showDoorOverlays} onChange={(e) => setShowDoorOverlays(e.target.checked)} />
                  Show door overlays
                </label>
                <p className="token-sub">Doors: {doorCounts.closed} closed / {doorCounts.open} open</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tokens in Scene</CardTitle>
                <CardDescription>Click row to select token</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea>
                  <div className="ui-grid">
                    {rosterTokens.map((token) => (
                      <button
                        key={token.id}
                        className={`token-row ${selectedId === token.id ? 'is-selected' : ''}`}
                        onClick={() => setSelectedId(token.id)}
                      >
                        {token.imageUrl ? (
                          <img src={token.imageUrl} alt={`${token.name} portrait`} className="token-thumb" />
                        ) : (
                          <span className="token-thumb token-fallback">{token.name.slice(0, 2).toUpperCase()}</span>
                        )}
                        <span className="token-meta">
                          <span className="token-name">{token.name}</span>
                          <span className="token-sub">
                            {roleLabel(token.role)} · {Math.round(token.x)}, {Math.round(token.y)}
                          </span>
                        </span>
                        <Badge>{token.visible ? 'shown' : 'hidden'}</Badge>
                      </button>
                    ))}
                    {rosterTokens.length === 0 && <p className="token-sub">No tokens yet.</p>}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {selectedToken && (
              <Card>
                <CardHeader>
                  <CardTitle>Selected Token</CardTitle>
                </CardHeader>
                <CardContent className="ui-grid">
                  <label className="ui-label" htmlFor="token-name">
                    Name
                    <Input
                      id="token-name"
                      value={selectedToken.name}
                      onChange={(e) => updateToken({ ...selectedToken, name: e.target.value })}
                    />
                  </label>
                  <label className="ui-label" htmlFor="token-role">
                    Role
                    <Select
                      id="token-role"
                      value={selectedToken.role}
                      onChange={(e) => updateToken({ ...selectedToken, role: e.target.value as TokenRole })}
                    >
                      <option value="player">Player</option>
                      <option value="npc">NPC</option>
                      <option value="dm_marker">DM Marker</option>
                    </Select>
                  </label>
                  <label className="ui-label" htmlFor="token-size">
                    Size
                    <Input
                      id="token-size"
                      type="number"
                      min={8}
                      value={selectedToken.size}
                      onChange={(e) => updateToken({ ...selectedToken, size: Number(e.target.value) })}
                    />
                  </label>
                  <label className="ui-check-row">
                    <Checkbox
                      checked={selectedToken.vision.enabled}
                      onChange={(e) =>
                        updateToken({
                          ...selectedToken,
                          vision: { ...selectedToken.vision, enabled: e.target.checked }
                        })
                      }
                    />
                    Vision enabled
                  </label>
                  <label className="ui-label" htmlFor="token-vision-radius">
                    Vision radius
                    <Input
                      id="token-vision-radius"
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
                  <label className="ui-check-row">
                    <Checkbox
                      checked={selectedToken.visible}
                      onChange={(e) => updateToken({ ...selectedToken, visible: e.target.checked })}
                    />
                    Visible
                  </label>

                  <label className="ui-label" htmlFor="token-image-upload">
                    Token portrait
                    <Input
                      id="token-image-upload"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          await uploadSelectedTokenImage(file);
                          setError(null);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Image upload failed');
                        }
                      }}
                    />
                  </label>

                  {selectedToken.imageUrl && (
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await removeSelectedTokenImage();
                          setError(null);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Failed to remove image');
                        }
                      }}
                    >
                      Remove Portrait
                    </Button>
                  )}

                  <Button
                    variant="danger"
                    onClick={() => send({ type: 'delete_token', payload: { sessionId, id: selectedToken.id } })}
                  >
                    Delete Token
                  </Button>
                </CardContent>
              </Card>
            )}

            {error && (
              <Card>
                <CardContent>
                  <p className="error-text">{error}</p>
                </CardContent>
              </Card>
            )}
          </aside>
        )}
      </div>

      {!isDm && error && (
        <Card>
          <CardContent>
            <p className="error-text">{error}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
