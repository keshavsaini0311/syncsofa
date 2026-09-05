import { useState } from 'react';

export function Home() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      const { id } = (await res.json()) as { id: string };
      window.location.href = `/r/${id}`;
    } catch {
      setBusy(false);
      alert('Could not create a room — is the server running?');
    }
  }

  return (
    <div className="home">
      <h1>🛋️ syncsofa</h1>
      <p>Watch YouTube together — in sync, on a call.</p>
      <button className="primary" onClick={create} disabled={busy}>
        Create a room
      </button>
      <form
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
  );
}
