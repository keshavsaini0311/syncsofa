import type { ServerMsg } from '@syncsofa/shared';
import type { RoomSocket } from './ws';

type SignalData =
  | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit };

export class PeerMesh {
  private peers = new Map<string, RTCPeerConnection>();
  private streams = new Map<string, MediaStream>();
  private localStream: MediaStream | null = null;
  private ice: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

  onStreams: (streams: Map<string, MediaStream>) => void = () => {};

  constructor(private socket: RoomSocket) {}

  async start(): Promise<MediaStream | null> {
    try {
      const res = await fetch('/api/ice');
      this.ice = ((await res.json()) as { iceServers: RTCIceServer[] }).iceServers;
    } catch {
      /* keep STUN default */
    }
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240 },
        audio: true,
      });
    } catch {
      this.localStream = null; // no cam/mic permission — still watch and see others
    }
    return this.localStream;
  }

  /** Called with the other participants' ids when OUR snapshot arrives: we are the newcomer, we offer. */
  offerTo(peerIds: string[]): void {
    for (const id of peerIds) void this.initiate(id);
  }

  handleSignal(msg: Extract<ServerMsg, { t: 'signal' }>): void {
    void this.handle(msg.from, msg.data as SignalData);
  }

  private pc(peerId: string): RTCPeerConnection {
    let pc = this.peers.get(peerId);
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: this.ice });
    this.peers.set(peerId, pc);
    for (const track of this.localStream?.getTracks() ?? []) pc.addTrack(track, this.localStream!);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal(peerId, { kind: 'ice', candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      this.streams.set(peerId, e.streams[0]);
      this.onStreams(new Map(this.streams));
    };
    pc.onconnectionstatechange = () => {
      if (pc!.connectionState === 'failed') this.drop(peerId);
    };
    return pc;
  }

  private async initiate(peerId: string): Promise<void> {
    this.drop(peerId); // fresh connection on (re)join
    const pc = this.pc(peerId);
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    this.signal(peerId, { kind: 'offer', sdp: offer });
  }

  // ponytail: simultaneous mutual reconnect can thrash offers briefly; converges at family scale —
  // perfect-negotiation pattern is the upgrade path
  private async handle(from: string, data: SignalData): Promise<void> {
    try {
      if (data.kind === 'offer') {
        this.drop(from); // remote rebuilt; rebuild our side too
        const pc = this.pc(from);
        await pc.setRemoteDescription(data.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.signal(from, { kind: 'answer', sdp: answer });
      } else if (data.kind === 'answer') {
        await this.peers.get(from)?.setRemoteDescription(data.sdp);
      } else if (data.kind === 'ice') {
        await this.peers.get(from)?.addIceCandidate(data.candidate);
      }
    } catch (err) {
      // stale candidate or race during rebuild — the offerer will retry via reconnect.
      // ponytail: log at debug (not error) since this is an expected, self-healing race,
      // not the hub's "anything could be wrong" case — but a silent catch here would hide
      // a real regression forever, so leave a trace like hub.ts does for its contained errors.
      console.debug('[rtc] signal handling failed, dropping', from, data.kind, err);
    }
  }

  drop(peerId: string): void {
    this.peers.get(peerId)?.close();
    this.peers.delete(peerId);
    if (this.streams.delete(peerId)) this.onStreams(new Map(this.streams));
  }

  setEnabled(kind: 'audio' | 'video', on: boolean): void {
    const tracks = kind === 'audio' ? this.localStream?.getAudioTracks() : this.localStream?.getVideoTracks();
    for (const t of tracks ?? []) t.enabled = on;
  }

  closeAll(): void {
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.localStream?.getTracks().forEach((t) => t.stop());
  }

  private signal(to: string, data: SignalData): void {
    this.socket.send({ t: 'signal', to, data });
  }
}
