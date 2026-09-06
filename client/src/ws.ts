import type { ClientMsg, ServerMsg } from '@syncsofa/shared';

export class RoomSocket {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private closed = false;
  private secret: string | undefined;

  onMessage: (msg: ServerMsg) => void = () => {};
  onDisconnect: () => void = () => {};

  constructor(
    private roomId: string,
    private name: string,
    private participantId: string,
  ) {}

  // arrives after the first join accepts (server-issued); a reconnect must carry it so the
  // server can tell "same participant reclaiming its id" from "someone else's id, no proof"
  setSecret(secret: string): void {
    this.secret = secret;
  }

  connect(): void {
    if (this.closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    // exposed so e2e can sever the connection and prove reconnect works; only the live socket
    // is retained, or a reconnect loop would pin every dead socket forever
    (window as unknown as { __sockets?: WebSocket[] }).__sockets = [ws];
    ws.onopen = () => {
      this.attempts = 0;
      const join: ClientMsg = {
        t: 'join',
        roomId: this.roomId,
        name: this.name,
        participantId: this.participantId,
        ...(this.secret ? { secret: this.secret } : {}),
      };
      ws.send(JSON.stringify(join));
    };
    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data as string) as ServerMsg);
    ws.onclose = () => {
      if (this.closed) return;
      this.onDisconnect();
      const delay = Math.min(15_000, 500 * 2 ** this.attempts++);
      setTimeout(() => this.connect(), delay);
    };
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
