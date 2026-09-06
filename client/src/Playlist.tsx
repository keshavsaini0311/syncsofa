import { memo, useState } from 'react';
import type { ClientMsg, PlaylistItem } from '@syncsofa/shared';

type Props = { items: PlaylistItem[]; currentItemId: number | null; send: (m: ClientMsg) => void };

export const Playlist = memo(function Playlist({ items, currentItemId, send }: Props) {
  const [url, setUrl] = useState('');
  return (
    <div className="panel playlist">
      <h2>
        Up next <span className="count">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="playlist-empty">Nothing queued yet.</p>
      ) : (
        <ul>
          {items.map((it, i) => {
            const isCurrent = it.id === currentItemId;
            return (
              <li key={it.id} className={isCurrent ? 'current' : ''}>
                <span className="index">{i + 1}</span>
                <span className="text">
                  <button className="title" title={`${it.title} — play now`} onClick={() => send({ t: 'playlist-play', itemId: it.id })}>
                    {it.title}
                  </button>
                  {/* .by keeps its original exact-text contract (just the name) — the e2e suite
                      asserts toHaveText on it directly, so the "Playing" tag and "added by"
                      label live in sibling elements around it instead of inside it. */}
                  <span className="meta">
                    {isCurrent && <span className="now-playing">Playing</span>}
                    {isCurrent && <span aria-hidden="true"> · </span>}
                    <span>added by </span>
                    <span className="by">{it.addedBy}</span>
                  </span>
                </span>
                <div className="controls">
                  <button disabled={i === 0} onClick={() => send({ t: 'playlist-move', itemId: it.id, toPosition: i - 1 })}>↑</button>
                  <button disabled={i === items.length - 1} onClick={() => send({ t: 'playlist-move', itemId: it.id, toPosition: i + 1 })}>↓</button>
                  <button onClick={() => send({ t: 'playlist-remove', itemId: it.id })}>✕</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const u = url.trim();
          if (u) {
            send({ t: 'playlist-add', url: u });
            setUrl('');
          }
        }}
      >
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a YouTube link…" />
        <button type="submit" className="primary">Add</button>
      </form>
    </div>
  );
});
