import { useCallback, useEffect, useRef, useState } from 'react';
import { Player } from './Player';
import { Playlist } from './Playlist';
import { Chat } from './Chat';
import { ReactionBar, ReactionOverlay } from './Reactions';
import { CallStrip } from './CallStrip';
import { ThemePicker } from './ThemePicker';
import { useRoomConnection } from './useRoomConnection';
import {
  JoinForm,
  RoomNotFoundScreen,
  ReplacedScreen,
  BadIdentityScreen,
  RoomFullScreen,
} from './screens/RoomScreens';

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

function RoomInner({ roomId, name }: { roomId: string; name: string }) {
  const { state, mesh, streams, localStream, send } = useRoomConnection(roomId, name);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const copyInvite = useCallback(async () => {
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
  }, []);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  if (state.error === 'room-not-found') return <RoomNotFoundScreen roomId={roomId} />;
  if (state.error === 'replaced') return <ReplacedScreen />;
  if (state.error === 'bad-identity') return <BadIdentityScreen roomId={roomId} />;
  if (state.error === 'room-full') return <RoomFullScreen />;

  const currentItem = state.playlist.find((i) => i.id === state.playback?.currentItemId) ?? null;

  return (
    <div className={`room${state.playback?.isPlaying ? ' is-playing' : ''}`}>
      <header>
        <a href="/" className="brand">
          syncsofa<span className="brand-dot">.</span>
        </a>
        <div className="topbar-right">
          <div className="room-code-group">
            <span className="room-code-label">Room</span>
            <span className="room-code">{roomId}</span>
            <button className="copy-btn" onClick={copyInvite} title="Copy invite link">
              <span className="copy-icon" aria-hidden="true"></span>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <span className="presence">{state.participants.length} here</span>
          <ThemePicker />
        </div>
      </header>
      <main>
        <div className="stage">
          <div className="video-stage">
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
          </div>
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
          <ReactionBar send={send} />
          <Playlist items={state.playlist} currentItemId={state.playback?.currentItemId ?? null} send={send} />
          <Chat messages={state.messages} send={send} selfName={name} />
        </aside>
      </main>
      {!state.joined && <div className="banner">Connecting…</div>}
      {state.error && state.error !== 'room-not-found' && (
        <div className="banner error">{errorMessage(state.error)}</div>
      )}
    </div>
  );
}
