import type { PlaybackState } from './types';

export function expectedTime(p: PlaybackState, now: number): number {
  if (!p.isPlaying) return p.time;
  return p.time + (now - p.updatedAt) / 1000;
}

export function needsCorrection(localTime: number, expected: number, thresholdSec = 1.5): boolean {
  return Math.abs(localTime - expected) > thresholdSec;
}
