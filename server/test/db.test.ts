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

function currentItemId(roomId: string): number | null {
  const row = db.prepare('SELECT current_item_id FROM rooms WHERE id = ?').get(roomId) as {
    current_item_id: number | null;
  };
  return row.current_item_id;
}

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

describe('current item tracking', () => {
  test('the first added item becomes current', () => {
    const a = addItem(db, 'ABC234', 'aaaaaaaaaaa', 'A', 'kes', NOW);
    addItem(db, 'ABC234', 'bbbbbbbbbbb', 'B', 'kes', NOW);
    expect(currentItemId('ABC234')).toBe(a.id);
  });

  test('removing the current item promotes the next one', () => {
    const a = addItem(db, 'ABC234', 'aaaaaaaaaaa', 'A', 'kes', NOW);
    const b = addItem(db, 'ABC234', 'bbbbbbbbbbb', 'B', 'kes', NOW);
    removeItem(db, 'ABC234', a.id, NOW);
    expect(currentItemId('ABC234')).toBe(b.id);
  });

  test('removing the only item leaves no current item', () => {
    const a = addItem(db, 'ABC234', 'aaaaaaaaaaa', 'A', 'kes', NOW);
    removeItem(db, 'ABC234', a.id, NOW);
    expect(currentItemId('ABC234')).toBeNull();
  });

  test('removing a non-current item leaves the current item alone', () => {
    const a = addItem(db, 'ABC234', 'aaaaaaaaaaa', 'A', 'kes', NOW);
    const b = addItem(db, 'ABC234', 'bbbbbbbbbbb', 'B', 'kes', NOW);
    removeItem(db, 'ABC234', b.id, NOW);
    expect(currentItemId('ABC234')).toBe(a.id);
  });
});

describe('cross-room isolation', () => {
  beforeEach(() => {
    createRoom(db, 'XYZ789', NOW);
  });

  test('removeItem cannot delete another room’s item', () => {
    const victim = addItem(db, 'XYZ789', 'vvvvvvvvvvv', 'Victim', 'bob', NOW);
    removeItem(db, 'ABC234', victim.id, NOW);
    expect(listItems(db, 'XYZ789').map((i) => i.id)).toEqual([victim.id]);
  });

  test('moveItem cannot reorder another room’s playlist', () => {
    const v1 = addItem(db, 'XYZ789', 'vvvvvvvvvvv', 'V1', 'bob', NOW);
    const v2 = addItem(db, 'XYZ789', 'wwwwwwwwwww', 'V2', 'bob', NOW);
    moveItem(db, 'ABC234', v2.id, 0);
    expect(listItems(db, 'XYZ789').map((i) => i.id)).toEqual([v1.id, v2.id]);
  });

  test('listItems and listMessages never leak across rooms', () => {
    addItem(db, 'XYZ789', 'vvvvvvvvvvv', 'V', 'bob', NOW);
    addMessage(db, 'XYZ789', 'bob', 'secret', NOW);
    expect(listItems(db, 'ABC234')).toEqual([]);
    expect(listMessages(db, 'ABC234')).toEqual([]);
  });

  test('a foreign itemId never disturbs either room’s current item', () => {
    const mine = addItem(db, 'ABC234', 'mmmmmmmmmmm', 'Mine', 'kes', NOW);
    const theirs = addItem(db, 'XYZ789', 'ttttttttttt', 'Theirs', 'bob', NOW);
    removeItem(db, 'ABC234', theirs.id, NOW);
    expect(currentItemId('ABC234')).toBe(mine.id);
    expect(currentItemId('XYZ789')).toBe(theirs.id);
  });
});
