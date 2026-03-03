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

## Notes
- WebSocket hub starts on `ws://localhost:8787` by default.
- Set `WS_PORT` to change backend WS port.
- Set `PUBLIC_WS_URL` in frontend runtime env if needed.
