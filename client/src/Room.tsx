import { useEffect, useReducer, useRef, useState } from 'react';
import type { ClientMsg } from '@syncsofa/shared';
import { initialState, roomReducer } from './roomReducer';
import { RoomSocket } from './ws';

export function Room({ roomId }: { roomId: string }) {
  const [name, setName] = useState<string | null>(() => localStorage.getItem('syncsofa-name'));
  if (!name) {
    return (
      <JoinForm
        roomId={roomId}
        onJoin={(n) => {
          localStorage.setItem('syncsofa-name', n);
          setName(n);
        }}
      />
    );
  }
  return <RoomInner roomId={roomId} name={name} />;
}

function JoinForm({ roomId, onJoin }: { roomId: string; onJoin: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="home">
      <h1>🛋️ syncsofa</h1>
      <p>
        Joining room <b>{roomId}</b>
      </p>
      <form
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

function participantId(): string {
  let pid = localStorage.getItem('syncsofa-pid');
  if (!pid) {
    pid = crypto.randomUUID();
    localStorage.setItem('syncsofa-pid', pid);
  }
  return pid;
}

function RoomInner({ roomId, name }: { roomId: string; name: string }) {
  const [state, dispatch] = useReducer(roomReducer, initialState);
  const reactionKey = useRef(0);
  const [socket] = useState(() => new RoomSocket(roomId, name, participantId()));

  useEffect(() => {
    socket.onMessage = (msg) => {
      if (msg.t === 'reaction') {
        const key = ++reactionKey.current;
        dispatch({ t: 'server', msg, key });
        setTimeout(() => dispatch({ t: 'reaction-expired', key }), 3000);
        return;
      }
      dispatch({ t: 'server', msg });
    };
    socket.onDisconnect = () => dispatch({ t: 'disconnected' });
    socket.connect();
    return () => socket.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = (m: ClientMsg) => socket.send(m);
  void send; // used by Tasks 9-11 panels

  if (state.error === 'room-not-found') {
    return (
      <div className="home">
        <h1>🛋️ syncsofa</h1>
        <p>Room {roomId} doesn’t exist.</p>
        <a href="/">Go home</a>
      </div>
    );
  }

  const currentItem = state.playlist.find((i) => i.id === state.playback?.currentItemId) ?? null;
  void currentItem; // used by Task 9

  return (
    <div className="room">
      <header>
        <a href="/" className="brand">🛋️ syncsofa</a>
        <button className="room-code" onClick={() => navigator.clipboard.writeText(location.href)} title="Copy invite link">
          {roomId} ⧉
        </button>
        <span className="presence">{state.participants.length} here</span>
      </header>
      <main>
        <div className="stage">
          <div className="video-wrap">
            <div className="empty">Add a YouTube link to get started →</div>
          </div>
        </div>
        <aside>{/* Playlist + Chat land here in Task 10 */}</aside>
      </main>
      {!state.joined && <div className="banner">Connecting…</div>}
    </div>
  );
}
