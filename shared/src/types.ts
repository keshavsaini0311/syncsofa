export type PlaylistItem = {
  id: number;
  videoId: string;
  title: string;
  position: number;
  addedBy: string;
};

export type PlaybackState = {
  currentItemId: number | null;
  isPlaying: boolean;
  time: number; // seconds into the video
  updatedAt: number; // ms epoch of last change
};

export type Participant = { id: string; name: string };

export type ChatMessage = { id: number; author: string; body: string; sentAt: number };

export type RoomSnapshot = {
  roomId: string;
  selfId: string;
  playback: PlaybackState;
  playlist: PlaylistItem[];
  participants: Participant[];
  messages: ChatMessage[];
};

export type ClientMsg =
  | { t: 'join'; roomId: string; name: string; participantId: string }
  | { t: 'play'; time: number }
  | { t: 'pause'; time: number }
  | { t: 'seek'; time: number }
  | { t: 'video-ended'; itemId: number }
  | { t: 'playlist-add'; url: string }
  | { t: 'playlist-remove'; itemId: number }
  | { t: 'playlist-move'; itemId: number; toPosition: number }
  | { t: 'playlist-play'; itemId: number }
  | { t: 'chat'; body: string }
  | { t: 'reaction'; emoji: string }
  | { t: 'signal'; to: string; data: unknown };

export type ServerMsg =
  | { t: 'snapshot'; snapshot: RoomSnapshot }
  | { t: 'playback'; playback: PlaybackState }
  | { t: 'playlist'; playlist: PlaylistItem[]; playback?: PlaybackState }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'reaction'; emoji: string; from: string }
  | { t: 'peer-joined'; participant: Participant }
  | { t: 'peer-left'; participantId: string }
  | { t: 'signal'; from: string; data: unknown }
  | { t: 'error'; code: string };
