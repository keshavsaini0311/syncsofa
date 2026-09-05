import { useEffect, useRef } from 'react';
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
    apiPromise = new Promise((resolve) => {
      if (window.YT?.Player) return resolve(window.YT);
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
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
      player.current = new YT.Player(holder.current, {
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
            if (Date.now() < suppressUntil.current) return;
            const time = player.current?.getCurrentTime?.() ?? 0;
            if (e.data === 1) sendRef.current({ t: 'play', time });
            else if (e.data === 2) sendRef.current({ t: 'pause', time });
            else if (e.data === 0) sendRef.current({ t: 'video-ended', itemId: itemIdRef.current });
          },
        },
      });
    });
    return () => {
      disposed = true;
      ready.current = false;
      player.current?.destroy?.();
      player.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // switch video when the current playlist item changes
  useEffect(() => {
    const p = player.current;
    if (!ready.current || !p?.loadVideoById) return;
    const pb = playbackRef.current;
    suppressUntil.current = Date.now() + 1500;
    lastPolled.current = -1;
    p.loadVideoById(videoId, pb ? Math.max(0, expectedTime(pb, Date.now())) : 0);
    if (pb && !pb.isPlaying) setTimeout(() => player.current?.pauseVideo?.(), 600);
  }, [videoId]);

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
      const local = p.getCurrentTime();
      const playing = p.getPlayerState?.() === 1;
      if (Date.now() > suppressUntil.current && playing) {
        // ponytail: seek = time jumped vs last poll; no native seek event exists
        if (lastPolled.current >= 0 && Math.abs(local - lastPolled.current - 1) > 2.5) {
          suppressUntil.current = Date.now() + 1000;
          sendRef.current({ t: 'seek', time: local });
        } else if (needsCorrection(local, expectedTime(pb, Date.now()))) {
          suppressUntil.current = Date.now() + 1000;
          p.seekTo(Math.max(0, expectedTime(pb, Date.now())), true);
        }
      }
      lastPolled.current = local;
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  return <div className="yt-holder" ref={holder} />;
}
