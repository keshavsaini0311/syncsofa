import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ClientMsg } from '@syncsofa/shared';

type Props = { messages: ChatMessage[]; send: (m: ClientMsg) => void };

export function Chat({ messages, send }: Props) {
  const [body, setBody] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className="panel chat">
      <h2>Chat</h2>
      <div className="chat-log">
        {messages.map((m) => (
          <div key={m.id} className="chat-msg">
            <b>{m.author}</b>
            {m.body}
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
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
