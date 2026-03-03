# AuVTT

Astro + React virtual tabletop MVP with:
- DM private board (`/dm/:sessionId`)
- Player public board (`/view/:sessionId`)
- Realtime token + scene sync over WebSockets
- SQLite persistence
- Universal VTT (`.dd2vtt` / `.uvtt`) import/export

## Run

```bash
npm install
npm run dev
```

Then open `http://localhost:4321`.

For LAN play-testing (other devices on same network):

```bash
npm run dev:lan
```

## Notes
- WebSocket hub starts on `ws://localhost:8787` by default.
- Set `WS_PORT` to change backend WS port.
- Set `PUBLIC_WS_URL` in frontend runtime env if needed.

## Docker

Build and run with make:

```bash
make docker-build
make docker-up
```

Then open `http://localhost:4321`.

Useful commands:

```bash
make docker-logs
make docker-down
```

Data persists in `./data` via a bind mount.
