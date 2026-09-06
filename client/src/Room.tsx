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

const ERROR_MESSAGES: Record<string, string> = {
  'bad-url': 'That doesn’t look like a YouTube link.',
  'bad-join': 'Could not join this room — try reloading.',
};

function errorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? 'Something went wrong.';
}

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

function participantId(): string {
  // sessionStorage, not localStorage: it survives reloads (all reconnect identity needs) but is
  // per-tab, so opening the room twice in one browser can't make two tabs fight over one id
  let pid = sessionStorage.getItem('syncsofa-pid');
  if (!pid) {
    // crypto.randomUUID is secure-context only; this app may run on a plain-http LAN address
    pid = crypto.randomUUID?.() ?? `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem('syncsofa-pid', pid);
  }
  return pid;
}

// sessionStorage, not localStorage: it's per-tab, matching the participant id it's paired with —
// two tabs are two different participants and must never share (or race over) one identity's secret
function storedSecret(roomId: string): string | undefined {
  return sessionStorage.getItem(`syncsofa-secret-${roomId}`) ?? undefined;
}

function RoomInner({ roomId, name }: { roomId: string; name: string }) {
  const [state, dispatch] = useReducer(roomReducer, initialState);
  const reactionKey = useRef(0);
  const pid = participantId();
  const [socket] = useState(() => new RoomSocket(roomId, name, pid));
  const [mesh] = useState(() => new PeerMesh(socket, pid));
  const [streams, setStreams] = useState<Map<string, MediaStream>>(new Map());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function copyInvite() {
    const url = location.href;
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // non-secure origin, or the document lost focus — let them copy it by hand
      prompt('Copy this link:', url);
    }
  }

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  useEffect(() => {
    const initialSecret = storedSecret(roomId);
    if (initialSecret) socket.setSecret(initialSecret);
    socket.onMessage = (msg) => {
      if (msg.t === 'signal') {
        mesh.handleSignal(msg);
        return;
      }
      if (msg.t === 'peer-left') mesh.drop(msg.participantId);
      if (msg.t === 'snapshot') {
        sessionStorage.setItem(`syncsofa-secret-${roomId}`, msg.snapshot.secret);
        socket.setSecret(msg.snapshot.secret);
        mesh.offerTo(msg.snapshot.participants.map((p) => p.id).filter((id) => id !== msg.snapshot.selfId));
      }
      if (msg.t === 'reaction') {
        const key = ++reactionKey.current;
        dispatch({ t: 'server', msg, key });
        setTimeout(() => dispatch({ t: 'reaction-expired', key }), 3000);
        return;
      }
      if (
        msg.t === 'error' &&
        (msg.code === 'replaced' || msg.code === 'room-not-found' || msg.code === 'bad-identity' || msg.code === 'room-full')
      ) {
        // deliberate server-side teardown (evicted by another tab, room never existed, identity
        // rejected, or room at capacity) — stop reconnecting and release the camera instead of
        // retrying forever behind a dead end
        socket.close();
        mesh.closeAll();
        dispatch({ t: 'server', msg });
        return;
      }
      if (msg.t === 'error') {
        dispatch({ t: 'server', msg });
        setTimeout(() => dispatch({ t: 'error-cleared' }), 4000);
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
      <div className="home home-status">
        <span className="eyebrow">Room unavailable</span>
        <h1>🛋️ syncsofa</h1>
        <p>Room {roomId} doesn’t exist.</p>
        <a href="/">Go home</a>
      </div>
    );
  }

  if (state.error === 'replaced') {
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

  if (state.error === 'bad-identity') {
    return (
      <div className="home home-status">
        <span className="eyebrow">Identity conflict</span>
        <h1>🛋️ syncsofa</h1>
        <p>Couldn’t rejoin — this room already has someone using this tab’s identity. Reload to join as a new participant.</p>
        <button
          className="primary"
          onClick={() => {
            sessionStorage.removeItem('syncsofa-pid');
            sessionStorage.removeItem(`syncsofa-secret-${roomId}`);
            location.reload();
          }}
        >
          Reload
        </button>
      </div>
    );
  }

  if (state.error === 'room-full') {
    return (
      <div className="home home-status">
        <span className="eyebrow">Room full</span>
        <h1>🛋️ syncsofa</h1>
        <p>This room is full (6 people max — the video call connects everyone directly, so it doesn’t scale past that).</p>
      </div>
    );
  }

  const currentItem = state.playlist.find((i) => i.id === state.playback?.currentItemId) ?? null;

  return (
    <div className={`room${state.playback?.isPlaying ? ' is-playing' : ''}`}>
      <header>
        <a href="/" className="brand">🛋️ syncsofa</a>
        <button className="room-code" onClick={copyInvite} title="Copy invite link">
          {copied ? 'Copied' : roomId} ⧉
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
              <div className="empty">Paste a YouTube link to start watching together.</div>
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
      {state.error && state.error !== 'room-not-found' && (
        <div className="banner error">{errorMessage(state.error)}</div>
      )}
    </div>
  );
}
