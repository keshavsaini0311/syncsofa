import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import type { ServerMsg } from '@syncsofa/shared';
import { createApp } from '../src/app';
import { createRoom, type Db } from '../src/db';
import { Hub } from '../src/hub';

export const fakeFetch = (async () =>
  new Response(JSON.stringify({ title: 'Stub Title' }), { status: 200 })) as typeof fetch;

/**
 * Boots a fresh http+ws server backed by the given (already-open) db, with room
 * ABC234 pre-created, and a Hub wired in with the stubbed oEmbed fetch. Each
 * caller supplies its own in-memory db, so servers started this way share
 * nothing with each other.
 */
export async function startHubServer(db: Db): Promise<{ server: Server; port: number }> {
  createRoom(db, 'ABC234', Date.now());
  const server = createServer(createApp(db));
  const wss = new WebSocketServer({ server, path: '/ws' });
  const hub = new Hub(db, fakeFetch);
  wss.on('connection', (ws) => hub.handleConnection(ws));
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  return { server, port };
}

export function nextMsg(ws: WebSocket, type: ServerMsg['t']): Promise<ServerMsg> {
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

export async function join(
  ws: WebSocket,
  participantId: string,
  name: string,
  secret?: string,
): Promise<ServerMsg> {
  const snap = nextMsg(ws, 'snapshot');
  ws.send(JSON.stringify({ t: 'join', roomId: 'ABC234', name, participantId, secret }));
  return snap;
}
