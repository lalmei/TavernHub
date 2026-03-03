export type TokenRole = 'player' | 'npc' | 'dm_marker';

export interface VisionSettings {
  enabled: boolean;
  radius: number;
  shape: 'circle';
}

export interface TokenRecord {
  id: string;
  sessionId: string;
  name: string;
  x: number;
  y: number;
  size: number;
  role: TokenRole;
  vision: VisionSettings;
  visible: boolean;
}

export interface MapRecord {
  sessionId: string;
  imageUrl: string;
  width: number;
  height: number;
  gridSize: number | null;
}

export interface SceneSettings {
  sessionId: string;
  fogEnabled: boolean;
  globalLight: boolean;
}

export interface SessionRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSnapshot {
  session: SessionRecord;
  map: MapRecord | null;
  scene: SceneSettings;
  tokens: TokenRecord[];
}

export interface UniversalVttFile {
  format: number;
  resolution: {
    map_origin: { x: number; y: number };
    map_size: { x: number; y: number };
    pixels_per_grid: number;
  };
  image?: string;
  line_of_sight: Array<Array<{ x: number; y: number }>>;
  portals: Array<{
    bounds:
      | [number, number, number, number]
      | [{ x: number; y: number }, { x: number; y: number }]
      | number[]
      | Array<{ x: number; y: number }>;
    closed?: boolean;
  }>;
  lights: Array<{
    position: { x: number; y: number };
    range: number;
    intensity?: number;
    color?: string;
  }>;
  extensions?: {
    auvtt?: {
      scene?: {
        fogEnabled?: boolean;
        globalLight?: boolean;
      };
      tokens?: Array<{
        id: string;
        name: string;
        x: number;
        y: number;
        size: number;
        role: TokenRole;
        vision: VisionSettings;
        visible: boolean;
      }>;
    };
  };
}

export type WsServerEvent =
  | { type: 'session_snapshot'; payload: SessionSnapshot }
  | { type: 'token_added'; payload: TokenRecord }
  | { type: 'token_updated'; payload: TokenRecord }
  | { type: 'token_moved'; payload: Pick<TokenRecord, 'id' | 'x' | 'y'> }
  | { type: 'token_deleted'; payload: { id: string } }
  | { type: 'scene_updated'; payload: SceneSettings }
  | { type: 'error'; payload: { message: string } };

export type WsClientEvent =
  | { type: 'join_session'; payload: { sessionId: string; role: 'dm' | 'viewer' } }
  | { type: 'add_token'; payload: Omit<TokenRecord, 'sessionId'> & { sessionId: string } }
  | { type: 'update_token'; payload: TokenRecord }
  | { type: 'move_token'; payload: { sessionId: string; id: string; x: number; y: number } }
  | { type: 'delete_token'; payload: { sessionId: string; id: string } }
  | { type: 'update_scene_settings'; payload: SceneSettings };
