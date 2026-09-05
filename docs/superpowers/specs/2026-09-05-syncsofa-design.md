# syncsofa — Design Spec

**Date:** 2026-09-05
**Status:** Approved (scope expanded per user: DB, chat, reactions, playlist, TURN included)

## What it is

Paste unlisted YouTube links into a shared playlist, share a room link, watch in
perfect sync with friends & family while seeing/hearing each other on a WebRTC
video call. No accounts — join a room with a display name.

## Decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Video source | YouTube unlisted links only | Zero storage/transcoding; YT IFrame API handles playback |
| Room size | ≤6 participants | WebRTC full mesh, no SFU/media server |
| Stack | One Node process: Vite+React client, Express+ws server, all TypeScript | One deploy, one reconnect path, runs anywhere |
| Persistence | SQLite (`better-sqlite3`) | Zero-ops single file; rooms/playlists/chat survive restarts |
| Auth | None | Display name on join; localStorage participant id for rejoin |
| TURN | Config, not code | `/api/ice` endpoint returns ICE servers from env; STUN-only fallback |

## Architecture

```
syncsofa/
├── client/                Vite + React + TS
│   ├── Player            YouTube IFrame player (the shared screen)
│   ├── CallStrip         webcam tiles, mute/cam toggles (WebRTC mesh)
│   ├── Playlist          queue panel: add/remove/reorder, now-playing
│   ├── Chat              message panel, persisted history
│   ├── Reactions         emoji bar + floating overlay on the video
│   └── Home / Join       create room, enter name
├── server/                Node + TS (one process)
│   ├── Express           serves built client, /api/rooms, /api/ice
│   ├── ws                one WebSocket per participant
│   └── SQLite            rooms, playlist_items, messages
└── shared/                message & state types shared by both sides
```

### One socket, four message families

All realtime traffic rides ONE WebSocket per participant:

1. **sync** — play/pause/seek/video-ended → server updates room state, broadcasts
2. **signal** — WebRTC offer/answer/ICE, relayed to one target peer
3. **chat** — message → persist → broadcast
4. **reaction / playlist / presence** — broadcast (reactions ephemeral; playlist ops persist)

## Data model (SQLite)

```sql
rooms(id TEXT PK,            -- 6-char code
      current_item_id INTEGER NULL,
      is_playing INTEGER, time REAL, updated_at INTEGER,
      created_at INTEGER)

playlist_items(id INTEGER PK AUTOINCREMENT,
      room_id TEXT, video_id TEXT, title TEXT,
      position INTEGER, added_by TEXT)

messages(id INTEGER PK AUTOINCREMENT,
      room_id TEXT, author TEXT, body TEXT, sent_at INTEGER)
```

Participants are in-memory only (they ARE the live sockets). Reactions are never
stored.

## Sync model

- Room playback state: `{currentItemId, isPlaying, time, updatedAt}`.
- Any participant's play/pause/seek updates state and broadcasts — no host role,
  everyone has the remote.
- Late joiners get state; expected position = `time + (now - updatedAt)` when playing.
- Drift correction: if `|local - expected| > 1.5s`, seek. Check on a 5s interval.
- Video ends → client sends `video-ended` → server advances to next playlist item
  (idempotent: first message wins, duplicates ignored).

## Playlist

- Ordered by `position`. Add by pasting any YouTube URL (server extracts video id;
  title fetched via YouTube oEmbed — no API key needed).
- Anyone can add/remove/reorder. Auto-advance on end; manual "play this now" jump.

## Call (WebRTC mesh)

- Every pair of participants connects directly; signaling relayed over the WS.
- New joiner initiates offers to existing peers (deterministic: joiner offers).
- ICE servers from `GET /api/ice`: STUN (Google) always; TURN appended when
  `TURN_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL` env vars are set.
- Tiles show name, mute/camera toggles local-only (tracks disabled, peers see
  frozen/blank + muted).

## Reactions

Emoji bar (❤️ 😂 😮 👏 🔥 😢). Click → broadcast → floats up over the video on
every screen for ~3s. Ephemeral by design.

## Error handling

- WS drop → auto-reconnect with exponential backoff; on reconnect, rejoin room and
  re-establish all peer connections from scratch (simplest correct thing).
- Peer socket close → server broadcasts leave; clients tear down that RTCPeerConnection.
- Unknown room code → friendly "room not found" → home.
- Empty rooms persist in SQLite (that's the point of the DB); a daily sweep deletes
  rooms untouched for 30 days.

## Testing

- **Vitest, server-side:** room state reducer, expected-position/drift math,
  playlist ordering + advance logic, YT URL parsing. These break silently — they get tests.
- **WebRTC/call:** verified manually with multiple browser windows (not unit-testable
  meaningfully).

## Deliberately skipped (add later without restructuring)

Accounts/auth, SFU for big rooms, direct video upload, moderation/roles,
mobile apps, reaction history.
