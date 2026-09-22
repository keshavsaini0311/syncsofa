import { useState } from 'react';

export function Home() {
  const [name, setName] = useState(() => localStorage.getItem('syncsofa-name') ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  // the room screen reads this key on load, so storing it here skips its join prompt entirely
  function rememberName() {
    const n = name.trim().slice(0, 40);
    if (n) localStorage.setItem('syncsofa-name', n);
  }

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
      rememberName();
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
      <div className="lobby">
        <label className="lobby-field">
          <span>Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={40}
          />
        </label>
        <button className="primary lobby-create" onClick={create} disabled={busy} aria-busy={busy}>
          Create a room
        </button>
        <p className="home-hint">Starts a new room and takes you straight there.</p>
        <div className="home-divider">
          <span>or join one</span>
        </div>
        <form
          className="home-join"
          onSubmit={(e) => {
            e.preventDefault();
            const c = code.trim().toUpperCase();
            if (!c) return;
            rememberName();
            window.location.href = `/r/${c}`;
          }}
        >
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Room code" maxLength={6} />
          <button type="submit">Join</button>
        </form>
      </div>
    </div>
  );
}
