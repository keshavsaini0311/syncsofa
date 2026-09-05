import { describe, expect, test } from 'vitest';
import type { RoomSnapshot, ServerMsg } from '@syncsofa/shared';
import { initialState, roomReducer } from '../src/roomReducer';

const snapshot: RoomSnapshot = {
  roomId: 'ABC234',
  selfId: 'p1',
  playback: { currentItemId: null, isPlaying: false, time: 0, updatedAt: 0 },
  playlist: [],
  participants: [{ id: 'p1', name: 'Alice' }],
  messages: [],
};

function apply(msgs: ServerMsg[], start = initialState) {
  return msgs.reduce((s, msg) => roomReducer(s, { t: 'server', msg, key: 7 }), start);
}

describe('roomReducer', () => {
  test('snapshot populates everything and sets joined', () => {
    const s = apply([{ t: 'snapshot', snapshot }]);
    expect(s.joined).toBe(true);
    expect(s.selfId).toBe('p1');
    expect(s.participants).toHaveLength(1);
  });

  test('peer-joined dedupes by id', () => {
    const s = apply([
      { t: 'snapshot', snapshot },
      { t: 'peer-joined', participant: { id: 'p2', name: 'Bob' } },
      { t: 'peer-joined', participant: { id: 'p2', name: 'Bob' } },
    ]);
    expect(s.participants).toHaveLength(2);
  });

  test('peer-left removes', () => {
    const s = apply([
      { t: 'snapshot', snapshot },
      { t: 'peer-joined', participant: { id: 'p2', name: 'Bob' } },
      { t: 'peer-left', participantId: 'p2' },
    ]);
    expect(s.participants.map((p) => p.id)).toEqual(['p1']);
  });

  test('chat appends and caps at 200', () => {
    let s = apply([{ t: 'snapshot', snapshot }]);
    for (let i = 0; i < 205; i++) {
      s = apply([{ t: 'chat', message: { id: i, author: 'a', body: `m${i}`, sentAt: i } }], s);
    }
    expect(s.messages).toHaveLength(200);
    expect(s.messages.at(-1)?.body).toBe('m204');
  });

  test('reaction added with key, expired removes it', () => {
    let s = apply([{ t: 'snapshot', snapshot }, { t: 'reaction', emoji: '🔥', from: 'Bob' }]);
    expect(s.reactions).toEqual([{ key: 7, emoji: '🔥', from: 'Bob' }]);
    s = roomReducer(s, { t: 'reaction-expired', key: 7 });
    expect(s.reactions).toEqual([]);
  });

  test('playlist message updates playback too when present', () => {
    const s = apply([
      { t: 'snapshot', snapshot },
      {
        t: 'playlist',
        playlist: [{ id: 1, videoId: 'aaaaaaaaaaa', title: 'A', position: 0, addedBy: 'Bob' }],
        playback: { currentItemId: 1, isPlaying: false, time: 0, updatedAt: 5 },
      },
    ]);
    expect(s.playlist).toHaveLength(1);
    expect(s.playback?.currentItemId).toBe(1);
  });

  test('disconnected clears joined', () => {
    let s = apply([{ t: 'snapshot', snapshot }]);
    s = roomReducer(s, { t: 'disconnected' });
    expect(s.joined).toBe(false);
  });

  test('error recorded', () => {
    const s = apply([{ t: 'error', code: 'room-not-found' }]);
    expect(s.error).toBe('room-not-found');
  });
});
