import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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

  test('room creation is limited per IP', async () => {
    // the limiter Map lives inside createApp (one per test's fresh app), so unlike a
    // module-level Map this test can rely on starting at a clean quota.
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) {
      const res = await fetch(`${base}/api/rooms`, { method: 'POST' });
      statuses.push(res.status);
      if (i === 0) {
        const { id } = (await res.json()) as { id: string };
        expect(id).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
      }
    }
    // catches a wrong ROOMS_PER_HOUR in either direction: too low would 429 inside this
    // loop, too high would let the 21st request below through.
    expect(statuses.every((s) => s === 200)).toBe(true);

    const denied = await fetch(`${base}/api/rooms`, { method: 'POST' });
    expect(denied.status).toBe(429);

    // a distinct visitor gets its own bucket. The connection to this test server comes
    // from loopback, and trust proxy is set to 'loopback', so X-Forwarded-For is honored
    // as req.ip -- this doubles as a check that Fix 1's trust-proxy setting is live.
    const otherIp = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { 'X-Forwarded-For': '203.0.113.7' },
    });
    expect(otherIp.status).toBe(200);

    // the window resets: fast-forward the clock past WINDOW_MS and the exhausted IP's
    // bucket is allowed again. Date.now() is a plain global call in app.ts, so spying on
    // it is enough -- no need to fake timers wholesale (which would also stall fetch's
    // own internal timers).
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60 * 60 * 1000 + 1);
    try {
      const afterWindow = await fetch(`${base}/api/rooms`, { method: 'POST' });
      expect(afterWindow.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });
});
