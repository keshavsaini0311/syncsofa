import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ClientMsg } from '@syncsofa/shared';
import { initialState, roomReducer } from './roomReducer';
import { RoomSocket } from './ws';
import { PeerMesh } from './rtc';
import { participantId, storedSecret, setStoredSecret } from './identity';

/**
 * Owns the room's live connection: the socket, the WebRTC mesh, server-message routing,
 * reaction expiry timers, and the call's media streams. `send` is a stable useCallback (the
 * socket instance never changes identity) so components downstream can be memoized against it.
 */
export function useRoomConnection(roomId: string, name: string) {
  const [state, dispatch] = useReducer(roomReducer, initialState);
  const reactionKey = useRef(0);
  const [pid] = useState(() => participantId());
  const [socket] = useState(() => new RoomSocket(roomId, name, pid));
  const [mesh] = useState(() => new PeerMesh(socket, pid));
  const [streams, setStreams] = useState<Map<string, MediaStream>>(new Map());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

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
        setStoredSecret(roomId, msg.snapshot.secret);
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

  const send = useCallback((m: ClientMsg) => socket.send(m), [socket]);

  return { state, mesh, streams, localStream, send };
}
