import { describe, expect, test } from 'vitest';
import { expectedTime, needsCorrection, type PlaybackState } from '@syncsofa/shared';

const base: PlaybackState = { currentItemId: 1, isPlaying: true, time: 100, updatedAt: 1_000_000 };

describe('expectedTime', () => {
  test('advances with wall clock while playing', () => {
    expect(expectedTime(base, 1_000_000 + 5_000)).toBeCloseTo(105);
  });
  test('frozen while paused', () => {
    expect(expectedTime({ ...base, isPlaying: false }, 1_000_000 + 60_000)).toBe(100);
  });
  test('zero elapsed', () => {
    expect(expectedTime(base, 1_000_000)).toBe(100);
  });
});

describe('needsCorrection', () => {
  test('within threshold: no', () => {
    expect(needsCorrection(100, 101.4)).toBe(false);
  });
  test('beyond threshold: yes', () => {
    expect(needsCorrection(100, 101.6)).toBe(true);
  });
  test('custom threshold', () => {
    expect(needsCorrection(100, 100.6, 0.5)).toBe(true);
  });
});
