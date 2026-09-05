import express from 'express';
import path from 'node:path';
import { genRoomCode } from './ids';
import { createRoom, roomExists, type Db } from './db';
import { iceServers } from './ice';

export function createApp(db: Db): express.Express {
  const app = express();

  app.post('/api/rooms', (_req, res) => {
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
