import { useEffect, useRef, useState } from 'react';
import { expectedTime, needsCorrection, type ClientMsg, type PlaybackState } from '@syncsofa/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<any> | null = null;
function loadYT(): Promise<any> {
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      if (window.YT?.Player) return resolve(window.YT);
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.onerror = () => reject(new Error('failed to load the YouTube IFrame API'));
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      // ponytail: plain timeout, no retry — a blocked script does not recover on its own
      setTimeout(() => reject(new Error('YouTube IFrame API timed out')), 10_000);
    });
    // let a later mount try again rather than caching the failure forever
    apiPromise.catch(() => {
      apiPromise = null;
    });
  }
  return apiPromise;
}

type Props = {
  videoId: string;
  itemId: number;
  playback: PlaybackState | null;
  send: (m: ClientMsg) => void;
};

export function Player({ videoId, itemId, playback, send }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const ready = useRef(false);
  const suppressUntil = useRef(0);
  const lastPolled = useRef(-1);
  const lastTickAt = useRef(0);
  // what applyRemote most recently drove the player toward, so we can consume exactly the one
  // resulting event instead of blanket-discarding every event for a fixed window.
  // a queue, not a single slot: a second remote change can arrive before the first one's event
  // lands, and overwriting would let the first event escape as a spurious user action
  const expecting = useRef<{ state: number; until: number }[]>([]);
  // guards the divergence reconciliation below from fighting a broadcast we just made ourselves
  const pendingUntil = useRef(0);
  const [failed, setFailed] = useState(false);

  // refs so the once-registered YT callbacks never see stale props
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const itemIdRef = useRef(itemId);
  itemIdRef.current = itemId;
  const sendRef = useRef(send);
  sendRef.current = send;

  function applyRemote() {
    const p = player.current;
    const pb = playbackRef.current;
    if (!ready.current || !p || !pb) return;
    suppressUntil.current = Date.now() + 1000;
    // long deadline is safe because we match on state, not time
    const now = Date.now();
    expecting.current = expecting.current.filter((e) => now < e.until);
    expecting.current.push({ state: pb.isPlaying ? 1 : 2, until: now + 5000 });
    const expected = Math.max(0, expectedTime(pb, Date.now()));
    if (Math.abs((p.getCurrentTime?.() ?? 0) - expected) > 0.75) p.seekTo(expected, true);
    if (pb.isPlaying) p.playVideo();
    else p.pauseVideo();
  }

  // create the player once
  useEffect(() => {
    let disposed = false;
    loadYT().then((YT) => {
      if (disposed || !holder.current) return;
      // YT.Player REPLACES the element it is given with an iframe. Hand it a throwaway child
      // so React never has to remove a node YouTube already swapped out — that race throws
      // removeChild NotFoundError and takes down the whole React tree.
      const mount = document.createElement('div');
      holder.current.appendChild(mount);
      player.current = new YT.Player(mount, {
        width: '100%',
        height: '100%',
        videoId,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            ready.current = true;
            applyRemote();
          },
          onStateChange: (e: any) => {
            // ENDED is never an echo worth discarding: a programmatic seek past the end is still
            // a genuine advance, and if every client suppresses it the room stalls forever
            if (e.data === 0) {
              sendRef.current({ t: 'video-ended', itemId: itemIdRef.current });
              return;
            }
            const nowSc = Date.now();
            const expIdx = expecting.current.findIndex((exp) => exp.state === e.data && nowSc < exp.until);
            if (expIdx !== -1) {
              // this is the event our own applyRemote caused — consume it, don't echo it
              expecting.current.splice(expIdx, 1);
              return;
            }
            // any other transition is the local user acting, even if it lands moments after a
            // remote change — that is precisely the case the old time window swallowed
            const time = player.current?.getCurrentTime?.() ?? 0;
            if (e.data === 1) {
              pendingUntil.current = Date.now() + 1500;
              sendRef.current({ t: 'play', time });
            } else if (e.data === 2) {
              pendingUntil.current = Date.now() + 1500;
              sendRef.current({ t: 'pause', time });
            }
          },
        },
      });
    }).catch(() => {
      if (!disposed) setFailed(true);
    });
    return () => {
      disposed = true;
      ready.current = false;
      player.current?.destroy?.();
      player.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // apply every remote playback change
  useEffect(() => {
    applyRemote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback]);

  // 1s tick: local seek detection + drift correction
  useEffect(() => {
    const iv = setInterval(() => {
      const p = player.current;
      const pb = playbackRef.current;
      if (!ready.current || !p?.getCurrentTime || !pb) return;

      const now = Date.now();
      const elapsed = lastTickAt.current ? (now - lastTickAt.current) / 1000 : 1;
      lastTickAt.current = now;

      // a hidden tab has its timers throttled to ~1/min, which makes our poll baseline
      // meaningless — resync from the room rather than inferring a seek from the gap
      if (elapsed > 2) {
        lastPolled.current = -1;
        applyRemote();
        return;
      }

      const playerState = p.getPlayerState?.();
      const playing = playerState === 1;
      const buffering = playerState === 3;

      // an applyRemote already driving toward the room's state is not divergence — it is a
      // player mid-buffer. Reconciling here would seekTo every tick and restart the buffer.
      // buffering is excluded outright too: a *local* scrub drops the player into BUFFERING with
      // no matching `expecting` entry, and treating that as play/pause divergence forced a
      // seekTo back to the room's position before the seek-detection below ever ran.
      const driving = expecting.current.some((e) => now < e.until && e.state === (pb.isPlaying ? 1 : 2));

      // if our play/pause state disagrees with the room's, and we have no action of our own in
      // flight, we diverged — re-apply the room's state rather than sitting out of sync forever
      if (!driving && !buffering && now > pendingUntil.current && playing !== pb.isPlaying) {
        lastPolled.current = -1; // don't let the next tick read the jump as a user seek
        applyRemote();
        return;
      }

      const local = p.getCurrentTime();

      if (now > suppressUntil.current && lastPolled.current >= 0) {
        // a seek is a position jump whether or not we're playing: scrubbing while paused moves
        // the position with no state change, and scrubbing while playing drops YT into BUFFERING.
        // Gating this on `playing` missed both, and drift correction then pulled the jump back.
        const jump = local - lastPolled.current - (playing ? elapsed : 0);
        if (Math.abs(jump) > 2.5) {
          suppressUntil.current = now + 1000;
          pendingUntil.current = now + 1500;
          expecting.current = []; // our own seek supersedes any pending remote expectation
          lastPolled.current = local;
          sendRef.current({ t: 'seek', time: local });
          return;
        }
      }

      if (now > suppressUntil.current && playing) {
        const expected = Math.max(0, expectedTime(pb, now));
        if (needsCorrection(local, expected)) {
          suppressUntil.current = now + 1000;
          p.seekTo(expected, true);
          lastPolled.current = expected;
          return;
        }
      }

      // hold the baseline through a buffer: the position is mid-transition and unreliable, and
      // clobbering it here is what made the seek invisible on the following tick
      if (!buffering) lastPolled.current = local;
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  if (failed) {
    return (
      <div className="empty">
        Couldn’t load the YouTube player — an ad blocker or network filter may be blocking it.
      </div>
    );
  }
  return <div className="yt-holder" ref={holder} />;
}
