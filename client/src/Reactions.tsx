import { memo } from 'react';
import type { ClientMsg } from '@syncsofa/shared';
import type { Reaction } from './roomReducer';

const EMOJIS = ['❤️', '😂', '😮', '👏', '🔥', '😢'];

export const ReactionBar = memo(function ReactionBar({ send }: { send: (m: ClientMsg) => void }) {
  return (
    <div className="panel reaction-panel">
      <span className="reaction-label">React</span>
      <div className="reaction-bar">
        {EMOJIS.map((e) => (
          <button key={e} onClick={() => send({ t: 'reaction', emoji: e })}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
});

export const ReactionOverlay = memo(function ReactionOverlay({ reactions }: { reactions: Reaction[] }) {
  return (
    <div className="reaction-overlay">
      {reactions.map((r) => (
        <div key={r.key} className="reaction-float" style={{ left: `${10 + ((r.key * 13) % 80)}%` }}>
          <span>{r.emoji}</span>
          <small>{r.from}</small>
        </div>
      ))}
    </div>
  );
});
