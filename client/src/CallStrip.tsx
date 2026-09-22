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
      {stream ? <video ref={ref} autoPlay playsInline muted={muted} /> : <div className="no-cam"><CamIcon on={false} /></div>}
      <span className="tile-name">{name}</span>
    </div>
  );
}

const ico = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function MicIcon({ on }: { on: boolean }) {
  return (
    <svg {...ico} aria-hidden>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
      {!on && <path d="M3 3l18 18" />}
    </svg>
  );
}

function CamIcon({ on }: { on: boolean }) {
  return (
    <svg {...ico} aria-hidden>
      <rect x="2" y="6" width="13" height="12" rx="2.5" />
      <path d="M15 10.5l6-3.5v10l-6-3.5z" />
      {!on && <path d="M3 3l18 18" />}
    </svg>
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
            <MicIcon on={micOn} />
          </button>
          <button
            className={camOn ? 'on' : 'off'}
            title={camOn ? 'Turn camera off' : 'Turn camera on'}
            onClick={() => {
              mesh.setEnabled('video', !camOn);
              setCamOn(!camOn);
            }}
          >
            <CamIcon on={camOn} />
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
