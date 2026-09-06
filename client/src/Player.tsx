import type { ClientMsg, PlaybackState } from '@syncsofa/shared';
import { useSyncedPlayer } from './useSyncedPlayer';

type Props = {
  videoId: string;
  itemId: number;
  playback: PlaybackState | null;
  send: (m: ClientMsg) => void;
};

export function Player({ videoId, itemId, playback, send }: Props) {
  const { holder, failed } = useSyncedPlayer({ videoId, itemId, playback, send });

  if (failed) {
    return (
      <div className="empty">
        Couldn’t load the YouTube player — an ad blocker or network filter may be blocking it.
      </div>
    );
  }
  return <div className="yt-holder" ref={holder} />;
}
