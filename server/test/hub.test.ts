import { afterEach, beforeEach, expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import type { ServerMsg } from '@syncsofa/shared';
import { createApp } from '../src/app';
import { addItem, createRoom, getPlayback, listMessages, openDb, type Db } from '../src/db';
import { Hub } from '../src/hub';

const fakeFetch = (async () =>
  new Response(JSON.stringify({ title: 'Stub Title' }), { status: 200 })) as typeof fetch;

let db: Db;
let server: Server;
let port: number;
const socks: WebSocket[] = [];

beforeEach(async () => {
  db = openDb(':memory:');
  createRoom(db, 'ABC234', Date.now());
  server = createServer(createApp(db));
  const wss = new WebSocketServer({ server, path: '/ws' });
  const hub = new Hub(db, fakeFetch);
  wss.on('connection', (ws) => hub.handleConnection(ws));
  await new Promise<void>((r) => server.listen(0, r));
  port = (server.address() as AddressInfo).port;
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

function nextMsg(ws: WebSocket, type: ServerMsg['t']): Promise<ServerMsg> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), 3000);
    const onMsg = (raw: Buffer) => {
      const msg = JSON.parse(String(raw)) as ServerMsg;
      if (msg.t === type) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(msg);
      }
    };
    ws.on('message', onMsg);
  });
}

async function join(ws: WebSocket, participantId: string, name: string, secret?: string): Promise<ServerMsg> {
  const snap = nextMsg(ws, 'snapshot');
  ws.send(JSON.stringify({ t: 'join', roomId: 'ABC234', name, participantId, secret }));
  return snap;
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

test('play broadcasts playback to everyone', async () => {
  const item = addItem(db, 'ABC234', 'aaaaaaaaaaa', 'A', 'kes', Date.now());
  const a = await connect();
  await join(a, 'p1', 'Alice');
  const b = await connect();
  await join(b, 'p2', 'Bob');

  const gotA = nextMsg(a, 'playback');
  const gotB = nextMsg(b, 'playback');
  a.send(JSON.stringify({ t: 'play', time: 12.5 }));
  const pbB = (await gotB) as Extract<ServerMsg, { t: 'playback' }>;
  expect(pbB.playback).toMatchObject({ isPlaying: true, time: 12.5, currentItemId: item.id });
  expect(((await gotA) as Extract<ServerMsg, { t: 'playback' }>).playback.isPlaying).toBe(true);
});

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

test('video-ended from three clients advances exactly one video', async () => {
  const i1 = addItem(db, 'ABC234', 'aaaaaaaaaaa', 'A', 'kes', Date.now());
  const i2 = addItem(db, 'ABC234', 'bbbbbbbbbbb', 'B', 'kes', Date.now());
  addItem(db, 'ABC234', 'ccccccccccc', 'C', 'kes', Date.now());
  const a = await connect();
  await join(a, 'p1', 'Alice');
  const b = await connect();
  await join(b, 'p2', 'Bob');
  const c = await connect();
  await join(c, 'p3', 'Cara');

  const playbacks: { currentItemId: number | null }[] = [];
  a.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as ServerMsg;
    if (m.t === 'playback') playbacks.push(m.playback);
  });

  a.send(JSON.stringify({ t: 'video-ended', itemId: i1.id }));
  b.send(JSON.stringify({ t: 'video-ended', itemId: i1.id }));
  c.send(JSON.stringify({ t: 'video-ended', itemId: i1.id }));
  await new Promise((r) => setTimeout(r, 300));

  expect(playbacks).toHaveLength(1);
  expect(playbacks[0].currentItemId).toBe(i2.id);
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

test('reaction broadcasts, is not persisted', async () => {
  const a = await connect();
  await join(a, 'p1', 'Alice');
  const got = nextMsg(a, 'reaction');
  a.send(JSON.stringify({ t: 'reaction', emoji: '🔥' }));
  const r = (await got) as Extract<ServerMsg, { t: 'reaction' }>;
  expect(r).toMatchObject({ emoji: '🔥', from: 'Alice' });
  expect(listMessages(db, 'ABC234')).toHaveLength(0);
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

test('the clock freezes when the last participant leaves', async () => {
  const item = addItem(db, 'ABC234', 'aaaaaaaaaaa', 'A', 'kes', Date.now());
  const a = await connect();
  await join(a, 'p1', 'Alice');
  a.send(JSON.stringify({ t: 'play', time: 100 }));
  await nextMsg(a, 'playback');

  a.close();
  await new Promise((r) => setTimeout(r, 150));

  const pb = getPlayback(db, 'ABC234')!;
  expect(pb.isPlaying).toBe(false);
  expect(pb.currentItemId).toBe(item.id);
  expect(pb.time).toBeGreaterThanOrEqual(100);
  expect(pb.time).toBeLessThan(102); // frozen at the real position, not extrapolated
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
});
