import { memo, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ClientMsg } from '@syncsofa/shared';

type Props = { messages: ChatMessage[]; send: (m: ClientMsg) => void; selfName: string };

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export const Chat = memo(function Chat({ messages, send, selfName }: Props) {
  const [body, setBody] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className="panel chat">
      <h2>Chat</h2>
      <div className="chat-log">
        {messages.length === 0 && <p className="chat-empty">No messages yet — say hi.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg${m.author === selfName ? ' you' : ''}`}>
            <span className="author">
              <b>{m.author}</b>
              <span className="time">{formatTime(m.sentAt)}</span>
            </span>
            <span className="bubble">{m.body}</span>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const b = body.trim();
          if (b) {
            send({ t: 'chat', body: b });
            setBody('');
          }
        }}
      >
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Say something…" />
        <button type="submit" className="primary">Send</button>
      </form>
    </div>
  );
});
