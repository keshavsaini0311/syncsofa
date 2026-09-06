import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Server } from 'node:http';
import { WebSocket } from 'ws';
import type { ServerMsg } from '@syncsofa/shared';
import { listMessages, openDb, type Db } from '../src/db';
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

test('chat persists and broadcasts', async () => {
  const a = await connect();
  await join(a, 'p1', 'Alice');
  const b = await connect();
  await join(b, 'p2', 'Bob');
  const got = nextMsg(b, 'chat');
  a.send(JSON.stringify({ t: 'chat', body: '  hello sofa  ' }));
  const msg = (await got) as Extract<ServerMsg, { t: 'chat' }>;
  expect(msg.message).toMatchObject({ author: 'Alice', body: 'hello sofa' });

  const c = await connect();
  const snapC = (await join(c, 'p3', 'Cara')) as Extract<ServerMsg, { t: 'snapshot' }>;
  expect(snapC.snapshot.messages.at(-1)?.body).toBe('hello sofa');
});

test('reaction broadcasts, is not persisted', async () => {
  const a = await connect();
  await join(a, 'p1', 'Alice');
  const got = nextMsg(a, 'reaction');
  a.send(JSON.stringify({ t: 'reaction', emoji: '🔥' }));
  const r = (await got) as Extract<ServerMsg, { t: 'reaction' }>;
  expect(r).toMatchObject({ emoji: '🔥', from: 'Alice' });
  expect(listMessages(db, 'ABC234')).toHaveLength(0);
});
