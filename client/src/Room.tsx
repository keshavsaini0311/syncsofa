import { useEffect, useReducer, useRef, useState } from 'react';
import type { ClientMsg } from '@syncsofa/shared';
import { Player } from './Player';
import { Playlist } from './Playlist';
import { Chat } from './Chat';
import { ReactionBar, ReactionOverlay } from './Reactions';
import { initialState, roomReducer } from './roomReducer';
import { RoomSocket } from './ws';
import { PeerMesh } from './rtc';
import { CallStrip } from './CallStrip';

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
    // crypto.randomUUID is secure-context only; this app may run on a plain-http LAN address
    pid = crypto.randomUUID?.() ?? `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('syncsofa-pid', pid);
  }
  return pid;
}

function RoomInner({ roomId, name }: { roomId: string; name: string }) {
  const [state, dispatch] = useReducer(roomReducer, initialState);
  const reactionKey = useRef(0);
  const [socket] = useState(() => new RoomSocket(roomId, name, participantId()));
  const [mesh] = useState(() => new PeerMesh(socket));
  const [streams, setStreams] = useState<Map<string, MediaStream>>(new Map());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    socket.onMessage = (msg) => {
      if (msg.t === 'signal') {
        mesh.handleSignal(msg);
        return;
      }
      if (msg.t === 'peer-left') mesh.drop(msg.participantId);
      if (msg.t === 'snapshot') {
        mesh.offerTo(msg.snapshot.participants.map((p) => p.id).filter((id) => id !== msg.snapshot.selfId));
      }
      if (msg.t === 'reaction') {
        const key = ++reactionKey.current;
        dispatch({ t: 'server', msg, key });
        setTimeout(() => dispatch({ t: 'reaction-expired', key }), 3000);
        return;
      }
      dispatch({ t: 'server', msg });
    };
    socket.onDisconnect = () => dispatch({ t: 'disconnected' });
    mesh.onStreams = setStreams;
    // media must be acquired before we connect: a snapshot could otherwise arrive
    // and trigger offers before any local track exists.
    mesh.start().then((ls) => {
      setLocalStream(ls);
      socket.connect();
    });
    return () => {
      mesh.closeAll();
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = (m: ClientMsg) => socket.send(m);

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

  return (
    <div className="room">
      <header>
        <a href="/" className="brand">🛋️ syncsofa</a>
        <button
          className="room-code"
          onClick={() => {
            // navigator.clipboard is secure-context only; fall back to a manual-copy prompt
            navigator.clipboard?.writeText(location.href).catch(() => prompt('Copy this link:', location.href));
            if (!navigator.clipboard) prompt('Copy this link:', location.href);
          }}
          title="Copy invite link"
        >
          {roomId} ⧉
        </button>
        <span className="presence">{state.participants.length} here</span>
      </header>
      <main>
        <div className="stage">
          <div className="video-wrap">
            {currentItem ? (
              <Player
                key={currentItem.id}
                videoId={currentItem.videoId}
                itemId={currentItem.id}
                playback={state.playback}
                send={send}
              />
            ) : (
              <div className="empty">Add a YouTube link to get started →</div>
            )}
            <ReactionOverlay reactions={state.reactions} />
          </div>
          <ReactionBar send={send} />
          <CallStrip
            mesh={mesh}
            localStream={localStream}
            streams={streams}
            participants={state.participants}
            selfId={state.selfId}
            selfName={name}
          />
        </div>
        <aside>
          <Playlist items={state.playlist} currentItemId={state.playback?.currentItemId ?? null} send={send} />
          <Chat messages={state.messages} send={send} />
        </aside>
      </main>
      {!state.joined && <div className="banner">Connecting…</div>}
    </div>
  );
}
