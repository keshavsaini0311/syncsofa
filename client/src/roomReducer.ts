import type {
  ChatMessage, Participant, PlaybackState, PlaylistItem, ServerMsg,
} from '@syncsofa/shared';

export type Reaction = { key: number; emoji: string; from: string };

export type RoomState = {
  joined: boolean;
  selfId: string;
  playback: PlaybackState | null;
  playlist: PlaylistItem[];
  participants: Participant[];
  messages: ChatMessage[];
  reactions: Reaction[];
  error: string | null;
};

export const initialState: RoomState = {
  joined: false,
  selfId: '',
  playback: null,
  playlist: [],
  participants: [],
  messages: [],
  reactions: [],
  error: null,
};

export type Action =
  | { t: 'server'; msg: ServerMsg; key?: number }
  | { t: 'reaction-expired'; key: number }
  | { t: 'disconnected' }
  | { t: 'error-cleared' };

export function roomReducer(state: RoomState, action: Action): RoomState {
  if (action.t === 'reaction-expired') {
    return { ...state, reactions: state.reactions.filter((r) => r.key !== action.key) };
  }
  if (action.t === 'disconnected') return { ...state, joined: false };
  if (action.t === 'error-cleared') {
    return state.error ? { ...state, error: null } : state;
  }

  const msg = action.msg;
  switch (msg.t) {
    case 'snapshot': {
      const s = msg.snapshot;
      return {
        ...state,
        joined: true,
        selfId: s.selfId,
        playback: s.playback,
        playlist: s.playlist,
        participants: s.participants,
        messages: s.messages,
        error: null,
      };
    }
    case 'playback':
      return { ...state, playback: msg.playback };
    case 'playlist':
      return { ...state, playlist: msg.playlist, playback: msg.playback ?? state.playback };
    case 'chat':
      return { ...state, messages: [...state.messages, msg.message].slice(-200) };
    case 'reaction':
      return { ...state, reactions: [...state.reactions, { key: action.key ?? 0, emoji: msg.emoji, from: msg.from }] };
    case 'peer-joined':
      return state.participants.some((p) => p.id === msg.participant.id)
        ? state
        : { ...state, participants: [...state.participants, msg.participant] };
    case 'peer-left':
      return { ...state, participants: state.participants.filter((p) => p.id !== msg.participantId) };
    case 'error':
      return { ...state, error: msg.code };
    case 'signal':
      return state; // handled by the rtc layer (Task 11), not the reducer
  }
}
