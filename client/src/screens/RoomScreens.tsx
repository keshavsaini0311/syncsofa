import { useState } from 'react';
import { clearIdentity } from '../identity';

export function JoinForm({ roomId, onJoin }: { roomId: string; onJoin: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="home">
      <div className="home-hero">
        <h1>🛋️ syncsofa</h1>
        <p className="home-tagline">
          Joining room <b className="home-roomid">{roomId}</b>
        </p>
      </div>
      <form
        className="join-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onJoin(name.trim().slice(0, 40));
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus maxLength={40} />
        <button type="submit" className="primary">
          Join
        </button>
      </form>
    </div>
  );
}

export function RoomNotFoundScreen({ roomId }: { roomId: string }) {
  return (
    <div className="home home-status">
      <span className="eyebrow">Room unavailable</span>
      <h1>🛋️ syncsofa</h1>
      <p>Room {roomId} doesn’t exist.</p>
      <a href="/">Go home</a>
    </div>
  );
}

export function ReplacedScreen() {
  return (
    <div className="home home-status">
      <span className="eyebrow">Opened elsewhere</span>
      <h1>🛋️ syncsofa</h1>
      <p>This room was opened in another tab or window, so this one disconnected.</p>
      <button className="primary" onClick={() => location.reload()}>
        Use this tab instead
      </button>
    </div>
  );
}

export function BadIdentityScreen({ roomId }: { roomId: string }) {
  return (
    <div className="home home-status">
      <span className="eyebrow">Identity conflict</span>
      <h1>🛋️ syncsofa</h1>
      <p>Couldn’t rejoin — this room already has someone using this tab’s identity. Reload to join as a new participant.</p>
      <button
        className="primary"
        onClick={() => {
          clearIdentity(roomId);
          location.reload();
        }}
      >
        Reload
      </button>
    </div>
  );
}

export function RoomFullScreen() {
  return (
    <div className="home home-status">
      <span className="eyebrow">Room full</span>
      <h1>🛋️ syncsofa</h1>
      <p>This room is full (6 people max — the video call connects everyone directly, so it doesn’t scale past that).</p>
    </div>
  );
}
