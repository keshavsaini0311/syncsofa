import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Server } from 'node:http';
import { WebSocket } from 'ws';
import type { ServerMsg } from '@syncsofa/shared';
import { addItem, getPlayback, openDb, type Db } from '../src/db';
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
