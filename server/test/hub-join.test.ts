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

test('join returns snapshot; peers get peer-joined', async () => {
  const a = await connect();
  const snapA = (await join(a, 'p1', 'Alice')) as Extract<ServerMsg, { t: 'snapshot' }>;
  expect(snapA.snapshot.selfId).toBe('p1');

  const b = await connect();
  const joined = nextMsg(a, 'peer-joined');
  const snapB = (await join(b, 'p2', 'Bob')) as Extract<ServerMsg, { t: 'snapshot' }>;
  expect(snapB.snapshot.participants.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
  expect(((await joined) as Extract<ServerMsg, { t: 'peer-joined' }>).participant.name).toBe('Bob');
});

test('join to unknown room errors and closes', async () => {
  const ws = await connect();
  const err = nextMsg(ws, 'error');
  const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
  ws.send(JSON.stringify({ t: 'join', roomId: 'ZZZZZZ', name: 'X', participantId: 'p9' }));
  expect(((await err) as Extract<ServerMsg, { t: 'error' }>).code).toBe('room-not-found');
  await closed;
});

test('close broadcasts peer-left', async () => {
  const a = await connect();
  await join(a, 'p1', 'Alice');
  const b = await connect();
  await join(b, 'p2', 'Bob');
  const left = nextMsg(a, 'peer-left');
  b.close();
  expect(((await left) as Extract<ServerMsg, { t: 'peer-left' }>).participantId).toBe('p2');
});

test('rejoining with the same participantId replaces the socket without a spurious peer-left', async () => {
  const a = await connect();
  const snapA = (await join(a, 'p1', 'Alice')) as Extract<ServerMsg, { t: 'snapshot' }>;
  const b = await connect();
  await join(b, 'p2', 'Bob');

  let bSawAliceLeave = false;
  b.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as ServerMsg;
    if (m.t === 'peer-left' && m.participantId === 'p1') bSawAliceLeave = true;
  });

  // Alice reconnects on a fresh socket carrying the same identity and its secret
  const a2 = await connect();
  const snap = (await join(a2, 'p1', 'Alice', snapA.snapshot.secret)) as Extract<ServerMsg, { t: 'snapshot' }>;
  expect(snap.snapshot.participants.map((p) => p.id).sort()).toEqual(['p1', 'p2']);

  await new Promise((r) => setTimeout(r, 150));
  expect(bSawAliceLeave).toBe(false);

  // the replacement must be the live socket: a broadcast reaches a2
  const chat = nextMsg(a2, 'chat');
  b.send(JSON.stringify({ t: 'chat', body: 'still there?' }));
  expect(((await chat) as Extract<ServerMsg, { t: 'chat' }>).message.body).toBe('still there?');
});

test('an evicted socket is told it was replaced', async () => {
  const a = await connect();
  const snapA = (await join(a, 'p1', 'Alice')) as Extract<ServerMsg, { t: 'snapshot' }>;
  const err = nextMsg(a, 'error');
  const a2 = await connect();
  await join(a2, 'p1', 'Alice', snapA.snapshot.secret);
  expect(((await err) as Extract<ServerMsg, { t: 'error' }>).code).toBe('replaced');
});

test('an unclaimed id is accepted and issued a secret', async () => {
  const a = await connect();
  const snap = (await join(a, 'p1', 'Alice')) as Extract<ServerMsg, { t: 'snapshot' }>;
  expect(typeof snap.snapshot.secret).toBe('string');
  expect(snap.snapshot.secret.length).toBeGreaterThan(0);
});

test('reclaiming with the correct secret works', async () => {
  const a = await connect();
  const snap = (await join(a, 'p1', 'Alice')) as Extract<ServerMsg, { t: 'snapshot' }>;
  const secret = snap.snapshot.secret;

  const replaced = nextMsg(a, 'error');
  const a2 = await connect();
  const snap2 = (await join(a2, 'p1', 'Alice', secret)) as Extract<ServerMsg, { t: 'snapshot' }>;
  expect(snap2.snapshot.selfId).toBe('p1');
  expect(((await replaced) as Extract<ServerMsg, { t: 'error' }>).code).toBe('replaced');
});

test('impersonation without the secret is rejected and the victim is untouched', async () => {
  const a = await connect();
  const snap = (await join(a, 'p1', 'Alice')) as Extract<ServerMsg, { t: 'snapshot' }>;
  expect(snap.snapshot.secret).toBeTruthy();

  const mallory = await connect();
  const err = nextMsg(mallory, 'error');
  const closed = new Promise<void>((resolve) => mallory.once('close', () => resolve()));
  mallory.send(JSON.stringify({ t: 'join', roomId: 'ABC234', name: 'Mallory', participantId: 'p1' }));
  expect(((await err) as Extract<ServerMsg, { t: 'error' }>).code).toBe('bad-identity');
  await closed;

  // prove liveness positively: Alice's original socket still receives broadcasts
  const b = await connect();
  await join(b, 'p2', 'Bob');
  const gotChat = nextMsg(a, 'chat');
  b.send(JSON.stringify({ t: 'chat', body: 'still alice?' }));
  expect(((await gotChat) as Extract<ServerMsg, { t: 'chat' }>).message.body).toBe('still alice?');
});

test('a wrong secret is rejected the same way', async () => {
  const a = await connect();
  await join(a, 'p1', 'Alice');

  const mallory = await connect();
  const err = nextMsg(mallory, 'error');
  const closed = new Promise<void>((resolve) => mallory.once('close', () => resolve()));
  mallory.send(JSON.stringify({ t: 'join', roomId: 'ABC234', name: 'Mallory', participantId: 'p1', secret: 'not-the-secret' }));
  expect(((await err) as Extract<ServerMsg, { t: 'error' }>).code).toBe('bad-identity');
  await closed;

  const b = await connect();
  await join(b, 'p2', 'Bob');
  const gotChat = nextMsg(a, 'chat');
  b.send(JSON.stringify({ t: 'chat', body: 'still alice too?' }));
  expect(((await gotChat) as Extract<ServerMsg, { t: 'chat' }>).message.body).toBe('still alice too?');
});

test('the 7th participant is rejected with room-full, and an existing participant can still reconnect', async () => {
  const socks6: WebSocket[] = [];
  const secrets: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const ws = await connect();
    const snap = (await join(ws, `p${i}`, `User${i}`)) as Extract<ServerMsg, { t: 'snapshot' }>;
    socks6.push(ws);
    secrets.push(snap.snapshot.secret);
  }

  const seventh = await connect();
  const err = nextMsg(seventh, 'error');
  const closed = new Promise<void>((resolve) => seventh.once('close', () => resolve()));
  seventh.send(JSON.stringify({ t: 'join', roomId: 'ABC234', name: 'Seventh', participantId: 'p7' }));
  expect(((await err) as Extract<ServerMsg, { t: 'error' }>).code).toBe('room-full');
  await closed;

  // an existing participant reconnecting into the (still full) room must be let back in
  const reconnected = await connect();
  const snap = (await join(reconnected, 'p1', 'User1', secrets[0])) as Extract<ServerMsg, { t: 'snapshot' }>;
  expect(snap.snapshot.selfId).toBe('p1');
  expect(snap.snapshot.participants).toHaveLength(6);

  // pin the write-ordering: the rejected 7th joiner must have left no trace in the
  // identities map. Free a seat, then let p7 join again with NO secret -- if their id had
  // been claimed at reject time (identities.set hoisted above the cap check), this join
  // would come back bad-identity instead of a fresh snapshot.
  socks6[1].close();
  await new Promise((r) => setTimeout(r, 150));
  const seventhRetry = await connect();
  const snapSeventh = (await join(seventhRetry, 'p7', 'Seventh')) as Extract<ServerMsg, { t: 'snapshot' }>;
  expect(snapSeventh.snapshot.selfId).toBe('p7');
});
