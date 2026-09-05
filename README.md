# syncsofa

Watch YouTube together, in sync, on a video call. Paste a YouTube link into a
shared playlist, send the room link to friends, and watch together while
seeing and hearing each other. Chat, emoji reactions, no accounts.

## Run it

```bash
npm install
npm run dev     # server on :3000, client (Vite) on :5173 — open http://localhost:5173
```

Production:

```bash
npm run build   # builds the client into client/dist
npm start       # one Node process serves everything on :3000
```

## Config

Copy `.env.example` to `.env`. Note that nothing in this app loads `.env`
files automatically — export the variables into your shell before running,
e.g.:

```bash
set -a; source .env; set +a
npm start
```

`PORT` and `DB_PATH` have working defaults (3000, `data/syncsofa.db`) and can
usually be left alone. `TURN_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL` are
optional — see the comments in `.env.example` for free TURN providers. Without
them, calls fall back to STUN only, which is fine on most home networks but
can fail on restrictive/corporate/mobile ones.

## How it works

One Node process. Express serves the built client and hosts one WebSocket per
participant, carrying four things: playback sync, WebRTC signaling relay,
chat, and playlist/reactions/presence. SQLite (`better-sqlite3`) persists
rooms, playlists, and chat so a refresh or reconnect doesn't lose state.
Video never touches the server — YouTube serves it via the IFrame API, and
the video call is peer-to-peer WebRTC, meshed directly between participants.

## Limits (by design)

- **Room size is about six people.** The call is a full mesh — every
  participant connects to every other one directly — so upload bandwidth
  grows with the square of the room size. There's no SFU/media server, so
  this is a soft practical ceiling, not an enforced cap.
- **Videos must be on YouTube.** Unlisted videos are the intended way to
  share something private — the room itself has no video storage.
- **No accounts, no per-user access control.** The room code is the only
  thing gating entry: anyone with the room link is in the room.

## Tests

```bash
npm test
```
