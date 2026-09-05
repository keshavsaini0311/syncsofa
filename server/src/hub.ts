import type { WebSocket } from 'ws';
import { expectedTime, type ClientMsg, type Participant, type RoomSnapshot, type ServerMsg } from '@syncsofa/shared';
import * as store from './db';
import { extractVideoId, fetchTitle } from './youtube';

type Conn = { ws: WebSocket; participant: Participant; roomId: string };

const isItemId = (v: unknown): v is number => Number.isInteger(v);

export class Hub {
  private rooms = new Map<string, Map<string, Conn>>(); // roomId -> participantId -> conn

  constructor(
    private db: store.Db,
    private fetchFn: typeof fetch = fetch,
  ) {}

  handleConnection(ws: WebSocket): void {
    let conn: Conn | null = null;
    ws.on('message', async (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw)) as ClientMsg;
      } catch {
        return;
      }
      try {
        if (!conn) {
          if (msg.t !== 'join') return ws.close();
          conn = this.join(ws, msg);
          return;
        }
        await this.handle(conn, msg);
      } catch (err) {
        // a malformed field (e.g. a non-string roomId, or an object/array where a
        // numeric itemId is expected) can throw synchronously deep in the store
        // (better-sqlite3 rejects non-primitive bind params). This handler is async,
        // so an uncaught throw becomes an unhandled rejection, which crashes the
        // whole Node process by default (Node >=15) -- taking every room down with
        // it, not just this connection. Contain the damage to this one socket, but
        // log loudly -- a silent catch here turns any future bug into a silent
        // disconnect with zero server-side trace.
        console.error('[hub] message handling failed, closing socket', err);
        ws.close();
      }
    });
    ws.on('close', () => {
      if (conn) this.leave(conn);
    });
  }

  private join(ws: WebSocket, msg: Extract<ClientMsg, { t: 'join' }>): Conn | null {
    const roomId = msg.roomId.toUpperCase();
    if (!store.roomExists(this.db, roomId)) {
      send(ws, { t: 'error', code: 'room-not-found' });
      ws.close();
      return null;
    }
    if (typeof msg.participantId !== 'string' || !msg.participantId) {
      send(ws, { t: 'error', code: 'bad-join' });
      ws.close();
      return null;
    }
    const name = typeof msg.name === 'string' ? msg.name.trim().slice(0, 40) : '';
    const participant: Participant = {
      id: msg.participantId.slice(0, 64),
      name: name || 'Guest',
    };
    let peers = this.rooms.get(roomId);
    if (!peers) {
      peers = new Map();
      this.rooms.set(roomId, peers);
    }
    const existing = peers.get(participant.id);
    if (existing) {
      // tell the old socket it was deliberately replaced, so its client stops reconnecting
      send(existing.ws, { t: 'error', code: 'replaced' });
      existing.ws.close();
    }
    const conn: Conn = { ws, participant, roomId };
    peers.set(participant.id, conn);

    const snapshot: RoomSnapshot = {
      selfId: participant.id,
      playback: store.getPlayback(this.db, roomId)!,
      playlist: store.listItems(this.db, roomId),
      participants: [...peers.values()].map((c) => c.participant),
      messages: store.listMessages(this.db, roomId),
    };
    send(ws, { t: 'snapshot', snapshot });
    this.broadcast(roomId, { t: 'peer-joined', participant }, participant.id);
    return conn;
  }

  private leave(conn: Conn): void {
    const peers = this.rooms.get(conn.roomId);
    if (peers?.get(conn.participant.id) === conn) {
      peers.delete(conn.participant.id);
      if (peers.size === 0) {
        this.rooms.delete(conn.roomId);
        // nobody is left to advance the clock, and expectedTime extrapolates without bound —
        // freeze at the real position so rejoining tomorrow resumes instead of fast-forwarding
        const pb = store.getPlayback(this.db, conn.roomId);
        if (pb?.isPlaying) {
          const now = Date.now();
          store.setPlayback(this.db, conn.roomId, false, expectedTime(pb, now), now);
        }
      }
      this.broadcast(conn.roomId, { t: 'peer-left', participantId: conn.participant.id });
    }
  }

  private async handle(conn: Conn, msg: ClientMsg): Promise<void> {
    const { roomId } = conn;
    const now = Date.now();
    switch (msg.t) {
      case 'play':
      case 'pause': {
        const pb = store.setPlayback(this.db, roomId, msg.t === 'play', Number(msg.time) || 0, now);
        if (pb) this.broadcast(roomId, { t: 'playback', playback: pb });
        break;
      }
      case 'seek': {
        const cur = store.getPlayback(this.db, roomId);
        const pb = store.setPlayback(this.db, roomId, cur?.isPlaying ?? false, Number(msg.time) || 0, now);
        if (pb) this.broadcast(roomId, { t: 'playback', playback: pb });
        break;
      }
      case 'video-ended': {
        if (!isItemId(msg.itemId)) return;
        const pb = store.advanceAfter(this.db, roomId, msg.itemId, now);
        if (pb) this.broadcast(roomId, { t: 'playback', playback: pb });
        break;
      }
      case 'playlist-add': {
        const videoId = extractVideoId(String(msg.url));
        if (!videoId) return send(conn.ws, { t: 'error', code: 'bad-url' });
        const title = await fetchTitle(videoId, this.fetchFn);
        store.addItem(this.db, roomId, videoId, title, conn.participant.name, now);
        this.broadcastPlaylist(roomId);
        break;
      }
      case 'playlist-remove':
        if (!isItemId(msg.itemId)) return;
        store.removeItem(this.db, roomId, msg.itemId, now);
        this.broadcastPlaylist(roomId);
        break;
      case 'playlist-move':
        if (!isItemId(msg.itemId) || !Number.isInteger(msg.toPosition)) return;
        store.moveItem(this.db, roomId, msg.itemId, msg.toPosition);
        this.broadcastPlaylist(roomId);
        break;
      case 'playlist-play': {
        if (!isItemId(msg.itemId)) return;
        const pb = store.playItem(this.db, roomId, msg.itemId, now);
        if (pb) this.broadcast(roomId, { t: 'playback', playback: pb });
        break;
      }
      case 'chat': {
        const body = String(msg.body).slice(0, 2000).trim();
        if (!body) return;
        const message = store.addMessage(this.db, roomId, conn.participant.name, body, now);
        this.broadcast(roomId, { t: 'chat', message });
        break;
      }
      case 'reaction':
        this.broadcast(roomId, { t: 'reaction', emoji: String(msg.emoji).slice(0, 8), from: conn.participant.name });
        break;
      case 'signal': {
        const target = this.rooms.get(roomId)?.get(String(msg.to));
        if (target) send(target.ws, { t: 'signal', from: conn.participant.id, data: msg.data });
        break;
      }
      case 'join':
        break; // already joined; ignore
    }
  }

  private broadcastPlaylist(roomId: string): void {
    this.broadcast(roomId, {
      t: 'playlist',
      playlist: store.listItems(this.db, roomId),
      playback: store.getPlayback(this.db, roomId) ?? undefined,
    });
  }

  private broadcast(roomId: string, msg: ServerMsg, exceptId?: string): void {
    for (const c of this.rooms.get(roomId)?.values() ?? []) {
      if (c.participant.id !== exceptId) send(c.ws, msg);
    }
  }
}

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
