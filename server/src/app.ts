import express from 'express';
import path from 'node:path';
import { genRoomCode } from './ids';
import { createRoom, roomExists, type Db } from './db';
import { iceServers } from './ice';

// ponytail: in-memory fixed window, per IP. Resets on restart and is per-process; that is fine
// for one small server. Move to a shared store only if this ever runs multi-instance.
const ROOMS_PER_HOUR = 20;
const WINDOW_MS = 60 * 60 * 1000;

export function createApp(db: Db): express.Express {
  const app = express();
  const roomCreates = new Map<string, { count: number; resetAt: number }>();

  // the README's https options (reverse proxy, ngrok, cloudflared) all terminate on this host,
  // so without this req.ip is the connector's address and every visitor shares one bucket.
  // 'loopback' not `true`: a directly-exposed instance must not let X-Forwarded-For be spoofed.
  app.set('trust proxy', 'loopback');

  app.post('/api/rooms', (req, res) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    let bucket = roomCreates.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + WINDOW_MS };
      roomCreates.set(key, bucket);
    }
    if (bucket.count >= ROOMS_PER_HOUR) {
      return res.status(429).json({ error: 'too-many-rooms' });
    }
    bucket.count++;

    if (roomCreates.size > 500) {
      for (const [k, v] of roomCreates) if (now > v.resetAt) roomCreates.delete(k);
      // a fixed window can afford to forget: if the sweep freed nothing we are under a
      // many-distinct-IP flood, and keeping the map is worse than resetting everyone's quota
      if (roomCreates.size > 500) roomCreates.clear();
    }

    let id = genRoomCode();
    while (roomExists(db, id)) id = genRoomCode();
    createRoom(db, id, Date.now());
    res.json({ id });
  });

  app.get('/api/rooms/:id', (req, res) => {
    if (roomExists(db, req.params.id.toUpperCase())) res.json({ ok: true });
    else res.status(404).json({ ok: false });
  });

  app.get('/api/ice', (_req, res) => {
    res.json({ iceServers: iceServers(process.env) });
  });

  // production static serving; in dev, Vite serves the client and proxies /api + /ws here
  const dist = path.resolve(import.meta.dirname, '../../client/dist');
  app.use(express.static(dist));
  app.get(/^\/r\//, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

  return app;
}
