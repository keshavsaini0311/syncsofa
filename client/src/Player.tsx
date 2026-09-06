import type { ClientMsg, PlaybackState } from '@syncsofa/shared';
import { useSyncedPlayer, type HintKind } from './useSyncedPlayer';

type Props = {
  videoId: string;
  itemId: number;
  playback: PlaybackState | null;
  send: (m: ClientMsg) => void;
};

// Copy per the project's voice: plain, second person, no apology, says what to do. 101/150 gets
// no shields advice — the uploader disabled embedding, so lowering shields would just be wrong.
const HINT_COPY: Record<HintKind, { text: string; ytLink?: boolean }> = {
  stalled: {
    text: "Video not starting? Your browser's privacy shields may be blocking YouTube. Try lowering them for this site, or sign in to YouTube in another tab.",
    ytLink: true,
  },
  'embed-disabled': {
    text: "This video's owner doesn't allow it to be played outside YouTube. Try a different video.",
  },
  unavailable: {
    text: "That video isn't available — it may have been removed or set to private.",
  },
  invalid: {
    text: "This video can't be played — the link looks broken.",
  },
  'html5-error': {
    text: 'This video hit a playback error. Try reloading the page.',
  },
};

export function Player({ videoId, itemId, playback, send }: Props) {
  const { holder, failed, hint, dismissHint } = useSyncedPlayer({ videoId, itemId, playback, send });

  if (failed) {
    return (
      <div className="empty">
        Couldn’t load the YouTube player — an ad blocker or network filter may be blocking it.
      </div>
    );
  }
  return (
    <>
      <div className="yt-holder" ref={holder} />
      {hint && (
        <div className="player-hint" role="status">
          <button
            type="button"
            className="player-hint-dismiss"
            onClick={dismissHint}
            aria-label="Dismiss"
          >
            ×
          </button>
          <p>
            {HINT_COPY[hint].text}
            {HINT_COPY[hint].ytLink && (
              <>
                {' '}
                <a
                  href={`https://www.youtube.com/watch?v=${videoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open on YouTube
                </a>
              </>
            )}
          </p>
        </div>
      )}
    </>
  );
}
