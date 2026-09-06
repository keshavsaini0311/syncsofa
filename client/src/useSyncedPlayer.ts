import { useEffect, useRef, useState } from 'react';
import { expectedTime, needsCorrection, type ClientMsg, type PlaybackState } from '@syncsofa/shared';
import { loadYT } from './youtubeApi';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Args = {
  videoId: string;
  itemId: number;
  playback: PlaybackState | null;
  send: (m: ClientMsg) => void;
};

export type Expectation = { state: number; until: number };

// Pure echo-suppression queue rules, pulled out of the hook so they're unit-testable without a
// real (or mocked) YT.Player: the hook only ever talks to the player through these two decisions.
//
// Decide the updated queue after applyRemote drives the player toward `targetState` (1 = playing,
// 2 = paused). Drops expired entries and any stale entry for this same state — at most one
// pending expectation per state, so an earlier still-live one can't outlive the transition it was
// for and later swallow an unrelated genuine action once the real event finally arrives and
// consumes a *different* queued entry. Then, unless the player is already effectively in the
// target state (playVideo()/pauseVideo() would be a no-op — no event will ever fire to consume an
// expectation for it), queues a fresh one with a 5s deadline, long enough to survive a slow buffer.
export function updateExpecting(
  queue: Expectation[],
  targetState: number,
  currentState: number | undefined,
  now: number,
): Expectation[] {
  const next = queue.filter((e) => now < e.until && e.state !== targetState);
  const alreadyThere = targetState === 1 ? currentState === 1 : currentState !== 1 && currentState !== 3;
  if (!alreadyThere) next.push({ state: targetState, until: now + 5000 });
  return next;
}

// Match a real onStateChange event against the queue. A hit means this event is the echo our own
// applyRemote caused — consume it (remove just that one entry) and discard the event. No hit means
// it's a genuine local action (play/pause/seek) to report.
export function consumeExpecting(
  queue: Expectation[],
  eventState: number,
  now: number,
): { echo: boolean; queue: Expectation[] } {
  const idx = queue.findIndex((e) => e.state === eventState && now < e.until);
  if (idx === -1) return { echo: false, queue };
  const next = queue.slice();
  next.splice(idx, 1);
  return { echo: true, queue: next };
}

// The sync engine: mounts a YT.Player, keeps it converging on the room's playback state, and
// reports local user actions (play/pause/seek/end) back to the room without echoing our own
// remote-driven changes. See the comments below — each one is the record of a bug already paid for.
export function useSyncedPlayer({ videoId, itemId, playback, send }: Args) {
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
    // see updateExpecting: this is what let a real early pause get swallowed — onReady used to
    // unconditionally queue a PAUSED echo that could never arrive, because the freshly-loaded
    // player wasn't playing yet to pause *from*, and it sat there for its full deadline
    expecting.current = updateExpecting(expecting.current, pb.isPlaying ? 1 : 2, p.getPlayerState?.(), now);
    const expected = Math.max(0, expectedTime(pb, Date.now()));
    // we know exactly where this puts the player — say so, so the anchor can never go stale
    // across a remote-driven move (buffering or not), which is what let case 4 misread a
    // post-buffer resume as a user seek and broadcast a stale, still-behind position.
    if (Math.abs((p.getCurrentTime?.() ?? 0) - expected) > 0.75) {
      p.seekTo(expected, true);
      lastPolled.current = expected;
    }
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
            const consumed = consumeExpecting(expecting.current, e.data, nowSc);
            expecting.current = consumed.queue;
            if (consumed.echo) return;
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

  return { holder, failed };
}
