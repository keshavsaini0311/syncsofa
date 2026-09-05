import { beforeEach, describe, expect, test } from 'vitest';
import {
  addItem, addMessage, createRoom, listItems, listMessages,
  moveItem, openDb, removeItem, roomExists, type Db,
} from '../src/db';
import { genRoomCode } from '../src/ids';

let db: Db;
const NOW = 1_700_000_000_000;
beforeEach(() => {
  db = openDb(':memory:');
  createRoom(db, 'ABC234', NOW);
});

test('genRoomCode: 6 chars, safe alphabet', () => {
  for (let i = 0; i < 50; i++) expect(genRoomCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
});

test('roomExists', () => {
  expect(roomExists(db, 'ABC234')).toBe(true);
  expect(roomExists(db, 'ZZZZZZ')).toBe(false);
});

describe('playlist', () => {
  test('add appends in order and returns the item', () => {
    const a = addItem(db, 'ABC234', 'aaaaaaaaaaa', 'Video A', 'kes', NOW);
    const b = addItem(db, 'ABC234', 'bbbbbbbbbbb', 'Video B', 'kes', NOW);
    expect(a.position).toBe(0);
    expect(b.position).toBe(1);
    expect(listItems(db, 'ABC234').map((i) => i.videoId)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  });

  test('remove reindexes positions', () => {
    const a = addItem(db, 'ABC234', 'aaaaaaaaaaa', 'A', 'kes', NOW);
    addItem(db, 'ABC234', 'bbbbbbbbbbb', 'B', 'kes', NOW);
    addItem(db, 'ABC234', 'ccccccccccc', 'C', 'kes', NOW);
    removeItem(db, 'ABC234', a.id, NOW);
    expect(listItems(db, 'ABC234').map((i) => [i.videoId, i.position])).toEqual([
      ['bbbbbbbbbbb', 0],
      ['ccccccccccc', 1],
    ]);
  });

  test('move reorders', () => {
    addItem(db, 'ABC234', 'aaaaaaaaaaa', 'A', 'kes', NOW);
    addItem(db, 'ABC234', 'bbbbbbbbbbb', 'B', 'kes', NOW);
    const c = addItem(db, 'ABC234', 'ccccccccccc', 'C', 'kes', NOW);
    moveItem(db, 'ABC234', c.id, 0);
    expect(listItems(db, 'ABC234').map((i) => i.videoId)).toEqual([
      'ccccccccccc', 'aaaaaaaaaaa', 'bbbbbbbbbbb',
    ]);
  });
});

describe('messages', () => {
  test('persist and list oldest-first with limit', () => {
    for (let i = 1; i <= 5; i++) addMessage(db, 'ABC234', 'kes', `msg ${i}`, NOW + i);
    const last3 = listMessages(db, 'ABC234', 3);
    expect(last3.map((m) => m.body)).toEqual(['msg 3', 'msg 4', 'msg 5']);
    expect(last3[0].author).toBe('kes');
    expect(last3[0].sentAt).toBe(NOW + 3);
  });
});
