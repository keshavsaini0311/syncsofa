import { describe, expect, test } from 'vitest';
import { consumeExpecting, updateExpecting, type Expectation } from '../src/useSyncedPlayer';

// YT.PlayerState values used below: -1 UNSTARTED, 1 PLAYING, 2 PAUSED, 3 BUFFERING, 5 CUED.

describe('useSyncedPlayer echo-suppression queue', () => {
  test('reported bug trace: a pause 2s after playback starts is no longer swallowed', () => {
    // t=0: player just mounted (still UNSTARTED), room's playback is not-playing.
    // onReady -> applyRemote() -> updateExpecting(queue=[], target=paused, current=UNSTARTED)
    let queue: Expectation[] = updateExpecting([], 2, -1, 0);
    // fixed: the player isn't playing yet, so pauseVideo() here is a no-op — nothing will ever
    // fire to consume an expectation, so none is queued. (Before the fix this unconditionally
    // pushed {state: 2, until: 5000}, which is the stale entry the report traces.)
    expect(queue).toEqual([]);

    // t=0: user starts playback; the room round-trips it back as a remote update.
    // applyRemote() runs again — by now the local player is already PLAYING (state 1).
    queue = updateExpecting(queue, 1, 1, 50);
    // already there (playVideo() on an already-playing player is a no-op) -> still nothing queued
    expect(queue).toEqual([]);

    // t=2000ms: user genuinely pauses. onStateChange(2) fires and is matched against the queue.
    const result = consumeExpecting(queue, 2, 2000);
    // fixed: no stale entry to misclassify this as an echo of -> it's reported as a real pause
    expect(result.echo).toBe(false);

    // Contrast: the pre-fix behavior (unconditional push, no same-state dedup) on this exact
    // sequence would have left {state: 2, until: 5000} sitting in the queue, and this same
    // consumeExpecting call would have matched it (2000 < 5000) and returned echo: true —
    // discarding the genuine pause. That is the bug this test guards against.
  });

  test('a remote play whose PLAYING event arrives several seconds late is still absorbed', () => {
    // room says playing, player is still buffering (slow network) when the expectation is queued
    let queue = updateExpecting([], 1, 3, 0);
    expect(queue).toEqual([{ state: 1, until: 5000 }]);
    // 4s later the buffer finally resolves and the real PLAYING event lands
    const result = consumeExpecting(queue, 1, 4000);
    expect(result.echo).toBe(true);
    expect(result.queue).toEqual([]);
  });

  test('two rapid opposite remote changes each keep their own pending event', () => {
    // remote play arrives while player is UNSTARTED
    let queue = updateExpecting([], 1, -1, 0);
    // moments later, remote pause arrives while the player is now BUFFERING (mid-transition
    // toward the first command) — a different state, so it does not replace the first entry
    queue = updateExpecting(queue, 2, 3, 50);
    expect(queue).toHaveLength(2);
    expect(queue).toEqual(
      expect.arrayContaining([
        { state: 1, until: 5000 },
        { state: 2, until: 5050 },
      ]),
    );

    // each real event consumes only its own entry
    const afterPlay = consumeExpecting(queue, 1, 100);
    expect(afterPlay.echo).toBe(true);
    expect(afterPlay.queue).toEqual([{ state: 2, until: 5050 }]);
    const afterPause = consumeExpecting(afterPlay.queue, 2, 200);
    expect(afterPause.echo).toBe(true);
    expect(afterPause.queue).toEqual([]);
  });

  test('at most one entry per state: repeated reconciliation retries do not stack duplicates', () => {
    // reconciliation ticks call applyRemote() again every second while still diverged
    let queue = updateExpecting([], 2, 1, 0); // player still playing, not paused yet
    expect(queue).toEqual([{ state: 2, until: 5000 }]);
    queue = updateExpecting(queue, 2, 1, 1000); // still hasn't paused a second later
    // deduped, not accumulated — exactly one live entry, refreshed
    expect(queue).toEqual([{ state: 2, until: 6000 }]);

    // if duplicates *had* stacked, the real event would only consume one of them, leaving a
    // stale duplicate able to swallow a later genuine pause — dedup means that can't happen:
    // consuming the single entry empties the queue outright.
    const result = consumeExpecting(queue, 2, 1500);
    expect(result.echo).toBe(true);
    expect(result.queue).toEqual([]);
  });
});
