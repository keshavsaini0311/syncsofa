import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Server } from 'node:http';
import { WebSocket } from 'ws';
import type { ServerMsg } from '@syncsofa/shared';
import { openDb, type Db } from '../src/db';
import { join, nextMsg, startHubServer } from './hub-harness';

let db: Db;
let server: Server;
let port: number;
const socks: WebSocket[] = [];

beforeEach(async () => {
  db = openDb(':memory:');
  ({ server, port } = await startHubServer(db));
});

afterEach(() => {
  for (const s of socks) s.close();
  socks.length = 0;
  server.close();
});

function connect(): Promise<WebSocket> {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  socks.push(ws);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

test('playlist-add persists, broadcasts playlist with stub title', async () => {
  const a = await connect();
  await join(a, 'p1', 'Alice');
  const got = nextMsg(a, 'playlist');
  a.send(JSON.stringify({ t: 'playlist-add', url: 'https://youtu.be/dQw4w9WgXcQ' }));
  const pl = (await got) as Extract<ServerMsg, { t: 'playlist' }>;
  expect(pl.playlist).toHaveLength(1);
  expect(pl.playlist[0]).toMatchObject({ videoId: 'dQw4w9WgXcQ', title: 'Stub Title', addedBy: 'Alice' });
  expect(pl.playback?.currentItemId).toBe(pl.playlist[0].id);
});

test('bad playlist url errors the sender only', async () => {
  const a = await connect();
  await join(a, 'p1', 'Alice');
  const b = await connect();
  await join(b, 'p2', 'Bob');
  let bGotError = false;
  b.on('message', (raw) => {
    if ((JSON.parse(String(raw)) as ServerMsg).t === 'error') bGotError = true;
  });
  const err = nextMsg(a, 'error');
  a.send(JSON.stringify({ t: 'playlist-add', url: 'https://vimeo.com/1' }));
  expect(((await err) as Extract<ServerMsg, { t: 'error' }>).code).toBe('bad-url');
  await new Promise((r) => setTimeout(r, 100));
  expect(bGotError).toBe(false);
});
