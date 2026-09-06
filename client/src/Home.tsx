import { useState } from 'react';

export function Home() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      if (!res.ok) {
        setBusy(false);
        alert(
          res.status === 429
            ? 'Too many rooms created from here — try again in a while.'
            : 'Could not create a room.',
        );
        return;
      }
      const { id } = (await res.json()) as { id: string };
      window.location.href = `/r/${id}`;
    } catch {
      setBusy(false);
      alert('Could not create a room — is the server running?');
    }
  }

  return (
    <div className="home">
      <div className="home-hero">
        <h1>🛋️ syncsofa</h1>
        <p className="home-tagline">Watch YouTube together — in sync, on a call.</p>
      </div>
      <div className="home-actions">
        <div className="home-create">
          <button className="primary" onClick={create} disabled={busy} aria-busy={busy}>
            Create a room
          </button>
          <p className="home-hint">Starts a new room and takes you straight there.</p>
        </div>
        <div className="home-divider">
          <span>or join one</span>
        </div>
        <form
          className="home-join"
          onSubmit={(e) => {
            e.preventDefault();
            const c = code.trim().toUpperCase();
            if (c) window.location.href = `/r/${c}`;
          }}
        >
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Room code" maxLength={6} />
          <button type="submit">Join</button>
        </form>
      </div>
    </div>
  );
}
