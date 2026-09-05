import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app';
import { openDb, sweepRooms } from './db';

const dbPath = process.env.DB_PATH ?? 'data/syncsofa.db';
if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = openDb(dbPath);

const app = createApp(db);
const server = createServer(app);

// rooms untouched for 30 days get swept once a day
setInterval(() => sweepRooms(db, 30 * 24 * 3600 * 1000, Date.now()), 24 * 3600 * 1000);

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`syncsofa listening on http://localhost:${port}`));

export { db, server };
