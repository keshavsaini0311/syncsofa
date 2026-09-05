import { beforeEach, expect, test } from 'vitest';
import {
  addItem, advanceAfter, createRoom, getPlayback, openDb, playItem,
  removeItem, roomExists, setPlayback, sweepRooms, type Db,
} from '../src/db';
import type { PlaylistItem } from '@syncsofa/shared';

let db: Db;
let a: PlaylistItem;
let b: PlaylistItem;
const NOW = 1_700_000_000_000;

beforeEach(() => {
  db = openDb(':memory:');
  createRoom(db, 'ABC234', NOW);
  a = addItem(db, 'ABC234', 'aaaaaaaaaaa', 'A', 'kes', NOW);
  b = addItem(db, 'ABC234', 'bbbbbbbbbbb', 'B', 'kes', NOW);
});

test('first added item becomes current, paused at 0', () => {
  expect(getPlayback(db, 'ABC234')).toEqual({ currentItemId: a.id, isPlaying: false, time: 0, updatedAt: NOW });
});

test('setPlayback updates state and clock', () => {
  const pb = setPlayback(db, 'ABC234', true, 42.5, NOW + 1000);
  expect(pb).toEqual({ currentItemId: a.id, isPlaying: true, time: 42.5, updatedAt: NOW + 1000 });
});

test('playItem jumps to an item from time 0, playing', () => {
  const pb = playItem(db, 'ABC234', b.id, NOW + 2000);
  expect(pb).toEqual({ currentItemId: b.id, isPlaying: true, time: 0, updatedAt: NOW + 2000 });
  expect(playItem(db, 'ABC234', 99999, NOW)).toBeNull();
});

test('advanceAfter moves to next item, playing', () => {
  const pb = advanceAfter(db, 'ABC234', a.id, NOW + 3000);
  expect(pb).toEqual({ currentItemId: b.id, isPlaying: true, time: 0, updatedAt: NOW + 3000 });
});

test('advanceAfter is idempotent: second ended for same item is a no-op', () => {
  advanceAfter(db, 'ABC234', a.id, NOW + 3000);
  expect(advanceAfter(db, 'ABC234', a.id, NOW + 3001)).toBeNull();
  expect(getPlayback(db, 'ABC234')!.currentItemId).toBe(b.id);
});

test('advanceAfter at last item stops playback', () => {
  advanceAfter(db, 'ABC234', a.id, NOW + 3000);
  const pb = advanceAfter(db, 'ABC234', b.id, NOW + 4000);
  expect(pb!.isPlaying).toBe(false);
  expect(pb!.currentItemId).toBe(b.id);
});

test('sweepRooms deletes only stale rooms', () => {
  createRoom(db, 'OLDROM', NOW - 100_000);
  const n = sweepRooms(db, 50_000, NOW);
  expect(n).toBe(1);
  expect(roomExists(db, 'OLDROM')).toBe(false);
  expect(roomExists(db, 'ABC234')).toBe(true);
});

test('removing a non-current item leaves the current item alone', () => {
  const c = addItem(db, 'ABC234', 'ccccccccccc', 'C', 'kes', NOW);
  playItem(db, 'ABC234', b.id, NOW + 100); // current is now the SECOND item
  removeItem(db, 'ABC234', c.id, NOW + 200); // remove a different, non-current item
  expect(getPlayback(db, 'ABC234')!.currentItemId).toBe(b.id);
});
