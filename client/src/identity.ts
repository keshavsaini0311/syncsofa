const PID_KEY = 'syncsofa-pid';
const secretKey = (roomId: string) => `syncsofa-secret-${roomId}`;

// sessionStorage, not localStorage: it survives reloads (all reconnect identity needs) but is
// per-tab, so opening the room twice in one browser can't make two tabs fight over one id
export function participantId(): string {
  let pid = sessionStorage.getItem(PID_KEY);
  if (!pid) {
    // crypto.randomUUID is secure-context only; this app may run on a plain-http LAN address
    pid = crypto.randomUUID?.() ?? `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(PID_KEY, pid);
  }
  return pid;
}

// sessionStorage, not localStorage: it's per-tab, matching the participant id it's paired with —
// two tabs are two different participants and must never share (or race over) one identity's secret
export function storedSecret(roomId: string): string | undefined {
  return sessionStorage.getItem(secretKey(roomId)) ?? undefined;
}

export function setStoredSecret(roomId: string, secret: string): void {
  sessionStorage.setItem(secretKey(roomId), secret);
}

// server rejected our id/secret pairing outright — clear both so a reload joins fresh as a new
// participant instead of retrying the same rejected identity forever
export function clearIdentity(roomId: string): void {
  sessionStorage.removeItem(PID_KEY);
  sessionStorage.removeItem(secretKey(roomId));
}
