# syncsofa

Watch YouTube together, in sync, on a video call. Paste a YouTube link into a
shared playlist, send the room link to friends, and watch together while
seeing and hearing each other. Chat, emoji reactions, no accounts.

**Live demo:** https://syncsofa.onrender.com/

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

## Deploy to Render

The repository includes a `render.yaml` Blueprint for a single Node web service
in Singapore, with HTTPS, WebSockets and a database-aware `/api/health` check.

1. Sign in to [Render](https://dashboard.render.com/).
2. Select **New > Blueprint** and connect this repository.
3. Review the `syncsofa` service and deploy it on the **Free** instance plan.
4. Open the generated HTTPS URL, create a room, and join its link from a second
   browser/device. Check chat, playlist sync and camera/microphone.

**Free demo storage is temporary:** SQLite lives under `/tmp/syncsofa`. Rooms,
playlists and messages are lost on restart, redeploy or idle spin-down. The first
visit after idle can take around a minute. Do not treat this as durable storage.
See [Render's free-tier limits](https://render.com/docs/free).

For persistent rooms, use a paid instance with a persistent disk and set
`DB_PATH` to a file inside that disk's mount path. Keep a single instance while
room membership and WebSocket routing live in process memory.

TURN remains optional: without it, calls may fail on restrictive/mobile networks.
Set `TURN_URL`, `TURN_USERNAME` and `TURN_CREDENTIAL` together in Render's
environment settings if a TURN service is available. These credentials are
returned to room participants, so use dedicated, limited relay credentials.

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

## Tests

```bash
npm test
```
