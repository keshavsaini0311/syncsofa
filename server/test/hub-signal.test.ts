import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Server } from 'node:http';
import { WebSocket } from 'ws';
import type { ServerMsg } from '@syncsofa/shared';
import { createRoom, openDb, type Db } from '../src/db';
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

test('signal reaches only its target, not other peers in the room', async () => {
  const a = await connect();
  await join(a, 'p1', 'Alice');
  const b = await connect();
  await join(b, 'p2', 'Bob');
  const c = await connect();
  await join(c, 'p3', 'Cara');
  let cGotSignal = false;
  c.on('message', (raw) => {
    if ((JSON.parse(String(raw)) as ServerMsg).t === 'signal') cGotSignal = true;
  });
  const got = nextMsg(b, 'signal');
  a.send(JSON.stringify({ t: 'signal', to: 'p2', data: { kind: 'offer', sdp: 'x' } }));
  const sig = (await got) as Extract<ServerMsg, { t: 'signal' }>;
  expect(sig.from).toBe('p1');
  expect(sig.data).toEqual({ kind: 'offer', sdp: 'x' });
  await new Promise((r) => setTimeout(r, 100));
  expect(cGotSignal).toBe(false);
});

test('signal never crosses rooms', async () => {
  createRoom(db, 'XYZ789', Date.now());
  const a = await connect();
  await join(a, 'p1', 'Alice');
  const outsider = await connect();
  const outsiderSnap = nextMsg(outsider, 'snapshot');
  outsider.send(JSON.stringify({ t: 'join', roomId: 'XYZ789', name: 'Mallory', participantId: 'p9' }));
  await outsiderSnap;
  let outsiderGotSignal = false;
  outsider.on('message', (raw) => {
    if ((JSON.parse(String(raw)) as ServerMsg).t === 'signal') outsiderGotSignal = true;
  });
  a.send(JSON.stringify({ t: 'signal', to: 'p9', data: { kind: 'offer', sdp: 'x' } }));
  await new Promise((r) => setTimeout(r, 150));
  expect(outsiderGotSignal).toBe(false);
});
