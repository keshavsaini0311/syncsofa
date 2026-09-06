import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { createApp } from './app';
import { openDb, sweepRooms } from './db';
import { Hub } from './hub';

const dbPath = process.env.DB_PATH ?? 'data/syncsofa.db';
if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = openDb(dbPath);

const app = createApp(db);
const server = createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });
const hub = new Hub(db);

type Alive = { isAlive?: boolean };

wss.on('connection', (ws) => {
  (ws as typeof ws & Alive).isAlive = true;
  ws.on('pong', () => {
    (ws as typeof ws & Alive).isAlive = true;
  });
  hub.handleConnection(ws);
});

// a client that dies without a FIN (wifi drop, airplane mode) would otherwise linger in the
// room map until the OS times out the socket — minutes to hours of ghost participants
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    const c = ws as typeof ws & Alive;
    if (c.isAlive === false) {
      ws.terminate();
      continue;
    }
    c.isAlive = false;
    ws.ping();
  }
}, 30_000);
wss.on('close', () => clearInterval(heartbeat));

// rooms untouched for 30 days get swept once a day
setInterval(() => sweepRooms(db, 30 * 24 * 3600 * 1000, Date.now()), 24 * 3600 * 1000);

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`syncsofa listening on http://localhost:${port}`));
