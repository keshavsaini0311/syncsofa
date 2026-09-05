import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';
import { iceServers } from '../src/ice';
import { openDb, type Db } from '../src/db';

describe('iceServers', () => {
  test('stun-only when TURN env is absent', () => {
    expect(iceServers({})).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
  });
  test('appends TURN when fully configured', () => {
    const s = iceServers({ TURN_URL: 'turn:t.example.com:3478', TURN_USERNAME: 'u', TURN_CREDENTIAL: 'p' });
    expect(s).toHaveLength(2);
    expect(s[1]).toEqual({ urls: 'turn:t.example.com:3478', username: 'u', credential: 'p' });
  });
  test('ignores partial TURN config', () => {
    expect(iceServers({ TURN_URL: 'turn:t.example.com' })).toHaveLength(1);
  });
});

describe('api', () => {
  let db: Db;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    db = openDb(':memory:');
    server = createServer(createApp(db));
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => server.close());

  test('POST /api/rooms creates a joinable room', async () => {
    const res = await fetch(`${base}/api/rooms`, { method: 'POST' });
    const { id } = (await res.json()) as { id: string };
    expect(id).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect((await fetch(`${base}/api/rooms/${id}`)).status).toBe(200);
    expect((await fetch(`${base}/api/rooms/${id.toLowerCase()}`)).status).toBe(200);
  });

  test('GET unknown room is 404', async () => {
    expect((await fetch(`${base}/api/rooms/ZZZZZZ`)).status).toBe(404);
  });

  test('GET /api/ice returns servers', async () => {
    const { iceServers: s } = (await (await fetch(`${base}/api/ice`)).json()) as { iceServers: unknown[] };
    expect(s.length).toBeGreaterThanOrEqual(1);
  });
});
