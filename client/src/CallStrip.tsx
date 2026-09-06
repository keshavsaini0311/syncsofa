import { memo, useEffect, useRef, useState } from 'react';
import type { Participant } from '@syncsofa/shared';
import type { PeerMesh } from './rtc';

function VideoTile({ stream, name, muted }: { stream: MediaStream | null; name: string; muted: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className={`tile${stream ? ' connected' : ''}`}>
      {stream ? <video ref={ref} autoPlay playsInline muted={muted} /> : <div className="no-cam">📷 off</div>}
      <span className="tile-name">{name}</span>
    </div>
  );
}

type Props = {
  mesh: PeerMesh;
  localStream: MediaStream | null;
  streams: Map<string, MediaStream>;
  participants: Participant[];
  selfId: string;
  selfName: string;
};

export const CallStrip = memo(function CallStrip({ mesh, localStream, streams, participants, selfId, selfName }: Props) {
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const others = participants.filter((p) => p.id !== selfId);
  return (
    <div className="call-strip-wrap">
      <div className="call-strip-heading">
        <h2>On the sofa</h2>
        <div className="call-controls">
          <button
            className={micOn ? 'on' : 'off'}
            title={micOn ? 'Mute mic' : 'Unmute mic'}
            onClick={() => {
              mesh.setEnabled('audio', !micOn);
              setMicOn(!micOn);
            }}
          >
            {micOn ? '🎙️' : '🔇'}
          </button>
          <button
            className={camOn ? 'on' : 'off'}
            title={camOn ? 'Turn camera off' : 'Turn camera on'}
            onClick={() => {
              mesh.setEnabled('video', !camOn);
              setCamOn(!camOn);
            }}
          >
            {camOn ? '📷' : '🚫'}
          </button>
        </div>
      </div>
      <div className="call-strip">
        <VideoTile stream={localStream} name={`${selfName} (you)`} muted />
        {others.map((p) => (
          <VideoTile key={p.id} stream={streams.get(p.id) ?? null} name={p.name} muted={false} />
        ))}
      </div>
    </div>
  );
});
