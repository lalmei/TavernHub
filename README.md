# TavernHub

TavernHub is a lightweight virtual tabletop built with Astro + React, mainly to be used in LAN setups. So focus is on simplicity, and not to replace
face-to-face interaction. 

<img width="802" height="636" alt="image" src="https://github.com/user-attachments/assets/f58cfa97-967d-44b5-93e7-31307157e5ef" />


It gives you:
- A private DM board: `/dm/:sessionId`
- A public player view: `/view/:sessionId`
- Realtime sync for tokens and scene state over WebSockets
- SQLite persistence in `./data`
- Universal VTT import/export (`.dd2vtt` / `.uvtt`)

If you use a universal vtt file it will also display line of sight for player map, which available on your local nettwork. 

<img width="2261" height="1304" alt="image" src="https://github.com/user-attachments/assets/7d23d5bd-6cce-4b68-9da6-7b45d0cf871a" />

## Quick Start (Local)

Requirements:
- Node.js 20+
- npm

Install and run:

```bash
npm install
npm run dev
```

Open:
- App: `http://127.0.0.1:5173`
- WebSocket hub (internal): `ws://127.0.0.1:8787`

LAN testing (same network):

```bash
npm run dev:lan
```

Then open `http://<your-machine-ip>:5173` from another device.

## First Session Flow


1. Go to `/` and click **Create Session**.
2. You will be redirected to your DM board at `/dm/<sessionId>`.
3. Share `/view/<sessionId>` with players.
4. Import a `.dd2vtt`/`.uvtt` map from the DM board if needed.

## Useful Commands

```bash
# local
npm run dev
npm run dev:lan
npm run build
npm run preview
npm test

# make shortcuts
make dev
make dev-lan
make build
make test
```

## Configuration

Environment variables:
- `WS_PORT` (default: `8787`): WebSocket server port.
- `PUBLIC_WS_URL` (optional): frontend WebSocket URL override.
- `HOST` and `PORT`: app bind host/port (used in Docker/production).

## Run with Docker

Build and start:

```bash
make docker-build
make docker-up
```

Open:
- App: `http://localhost:4321`
- WebSocket: `ws://localhost:8787`

Common Docker commands:

```bash
make docker-logs
make docker-ps
make docker-down
```

Data is persisted by bind mount at `./data`.
