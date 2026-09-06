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

**Note:** Camera and microphone require HTTPS or localhost (browser
restriction). Chat, video playback, and playlists work fine over plain HTTP.
For local testing, use `http://localhost:3000`; for watching together on a
network, deploy behind HTTPS (reverse proxy, ngrok, or Cloudflare Tunnel). On
a plain-HTTP LAN address, camera will silently appear off with no error.

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

- **Room size is limited to six people.** The call is a full mesh — every
  participant connects to every other one directly — so upload bandwidth
  grows with the square of the room size. The server enforces this limit,
  rejecting new joiners when a room is full.
- **Videos must be on YouTube.** Unlisted videos are the intended way to
  share something private — the room itself has no video storage.
- **No accounts, no per-user access control.** The room code is the only
  thing gating entry: anyone with the room link is in the room.

## Deploy

**Serverless hosts (Vercel, Netlify functions) will not work.** This app is
one long-lived Node process holding a WebSocket per participant and writing
to a SQLite file on disk — serverless functions are stateless, short-lived,
and have no persistent filesystem, so both the sockets and the database
would break. It needs a host that runs a container or VM continuously with a
mounted volume.

A `Dockerfile` is included (multi-stage: builds the client, runs the server
via `tsx` as it does locally — there's no compiled server `dist`). Build it
with `docker build -t syncsofa .`.

### Fly.io

```bash
fly launch --no-deploy        # detects the Dockerfile, edit fly.toml's app name first
fly volumes create syncsofa_data --size 1 -r <region>
fly deploy
```

`fly.toml` already sets `PORT`/`DB_PATH` and mounts the volume at `/data`
(matching `DB_PATH=/data/syncsofa.db`). Set TURN credentials as secrets, not
plain env vars: `fly secrets set TURN_URL=... TURN_USERNAME=... TURN_CREDENTIAL=...`.

### Railway / Render

Either works the same way: point it at the `Dockerfile`, and mount a
persistent disk/volume at whatever path `DB_PATH` points to (default
`/data/syncsofa.db` in the container) — without one, the database resets on
every redeploy. Set `TURN_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL` in the
host's env var / secrets UI.

All three terminate HTTPS by default, which is required for camera/mic
anyway (see the HTTPS note above) — no separate reverse proxy needed.

## Tests

```bash
npm test
```
