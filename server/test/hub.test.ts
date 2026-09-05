import { afterEach, beforeEach, expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import type { ServerMsg } from '@syncsofa/shared';
import { createApp } from '../src/app';
import { addItem, createRoom, openDb, type Db } from '../src/db';
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

async function join(ws: WebSocket, participantId: string, name: string): Promise<ServerMsg> {
  const snap = nextMsg(ws, 'snapshot');
  ws.send(JSON.stringify({ t: 'join', roomId: 'ABC234', name, participantId }));
  return snap;
}

test('join returns snapshot; peers get peer-joined', async () => {
  const a = await connect();
  const snapA = (await join(a, 'p1', 'Alice')) as Extract<ServerMsg, { t: 'snapshot' }>;
  expect(snapA.snapshot.selfId).toBe('p1');
  expect(snapA.snapshot.roomId).toBe('ABC234');

  const b = await connect();
  const joined = nextMsg(a, 'peer-joined');
  const snapB = (await join(b, 'p2', 'Bob')) as Extract<ServerMsg, { t: 'snapshot' }>;
  expect(snapB.snapshot.participants.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
  expect(((await joined) as Extract<ServerMsg, { t: 'peer-joined' }>).participant.name).toBe('Bob');
});

test('join to unknown room errors and closes', async () => {
  const ws = await connect();
  const err = nextMsg(ws, 'error');
  ws.send(JSON.stringify({ t: 'join', roomId: 'ZZZZZZ', name: 'X', participantId: 'p9' }));
  expect(((await err) as Extract<ServerMsg, { t: 'error' }>).code).toBe('room-not-found');
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

test('bad playlist url errors sender only', async () => {
  const a = await connect();
  await join(a, 'p1', 'Alice');
  const err = nextMsg(a, 'error');
  a.send(JSON.stringify({ t: 'playlist-add', url: 'https://vimeo.com/1' }));
  expect(((await err) as Extract<ServerMsg, { t: 'error' }>).code).toBe('bad-url');
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

test('signal relays only to target', async () => {
  const a = await connect();
  await join(a, 'p1', 'Alice');
  const b = await connect();
  await join(b, 'p2', 'Bob');
  const got = nextMsg(b, 'signal');
  a.send(JSON.stringify({ t: 'signal', to: 'p2', data: { kind: 'offer', sdp: 'x' } }));
  const sig = (await got) as Extract<ServerMsg, { t: 'signal' }>;
  expect(sig.from).toBe('p1');
  expect(sig.data).toEqual({ kind: 'offer', sdp: 'x' });
});

test('video-ended advances once even if two clients report it', async () => {
  const i1 = addItem(db, 'ABC234', 'aaaaaaaaaaa', 'A', 'kes', Date.now());
  const i2 = addItem(db, 'ABC234', 'bbbbbbbbbbb', 'B', 'kes', Date.now());
  const a = await connect();
  await join(a, 'p1', 'Alice');
  const b = await connect();
  await join(b, 'p2', 'Bob');
  const got = nextMsg(a, 'playback');
  a.send(JSON.stringify({ t: 'video-ended', itemId: i1.id }));
  b.send(JSON.stringify({ t: 'video-ended', itemId: i1.id }));
  const pb = (await got) as Extract<ServerMsg, { t: 'playback' }>;
  expect(pb.playback.currentItemId).toBe(i2.id);
  expect(pb.playback.isPlaying).toBe(true);
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
});
