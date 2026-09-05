import { useState } from 'react';
import type { ClientMsg, PlaylistItem } from '@syncsofa/shared';

type Props = { items: PlaylistItem[]; currentItemId: number | null; send: (m: ClientMsg) => void };

export function Playlist({ items, currentItemId, send }: Props) {
  const [url, setUrl] = useState('');
  return (
    <div className="panel playlist">
      <h2>Playlist</h2>
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
        <button type="submit">Add</button>
      </form>
      <ul>
        {items.map((it, i) => (
          <li key={it.id} className={it.id === currentItemId ? 'current' : ''}>
            <button className="title" title={`${it.title} — play now`} onClick={() => send({ t: 'playlist-play', itemId: it.id })}>
              {it.title}
            </button>
            <span className="by">{it.addedBy}</span>
            <button disabled={i === 0} onClick={() => send({ t: 'playlist-move', itemId: it.id, toPosition: i - 1 })}>↑</button>
            <button disabled={i === items.length - 1} onClick={() => send({ t: 'playlist-move', itemId: it.id, toPosition: i + 1 })}>↓</button>
            <button onClick={() => send({ t: 'playlist-remove', itemId: it.id })}>✕</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
