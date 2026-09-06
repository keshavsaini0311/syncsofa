import { describe, expect, test } from 'vitest';
import type { RoomSnapshot, ServerMsg } from '@syncsofa/shared';
import { initialState, roomReducer } from '../src/roomReducer';

const snapshot: RoomSnapshot = {
  selfId: 'p1',
  secret: 'test-secret',
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

  test('an error is recorded and can be cleared', () => {
    const withError = apply([{ t: 'snapshot', snapshot }, { t: 'error', code: 'bad-url' }]);
    expect(withError.error).toBe('bad-url');

    const cleared = roomReducer(withError, { t: 'error-cleared' });
    expect(cleared.error).toBeNull();

    // clearing again is a no-op and must return the identical reference
    expect(roomReducer(cleared, { t: 'error-cleared' })).toBe(cleared);
  });

  test('a state-changing action returns new objects and leaves the old ones untouched', () => {
    const before = apply([{ t: 'snapshot', snapshot }]);
    const participantsRef = before.participants;
    const after = roomReducer(before, {
      t: 'server',
      msg: { t: 'peer-joined', participant: { id: 'p2', name: 'Bob' } },
    });
    expect(after).not.toBe(before);
    expect(after.participants).not.toBe(participantsRef);
    expect(participantsRef).toHaveLength(1); // the previous array must not have been mutated
    expect(after.participants).toHaveLength(2);
  });

  test('chat append leaves the previous messages array untouched', () => {
    const before = apply([
      { t: 'snapshot', snapshot },
      { t: 'chat', message: { id: 1, author: 'a', body: 'x', sentAt: 1 } },
    ]);
    const messagesRef = before.messages;
    const after = roomReducer(before, {
      t: 'server',
      msg: { t: 'chat', message: { id: 2, author: 'b', body: 'y', sentAt: 2 } },
    });
    expect(messagesRef).toHaveLength(1);
    expect(after.messages).toHaveLength(2);
    expect(after.messages).not.toBe(messagesRef);
  });

  test('no-op actions return the identical state reference', () => {
    const s = apply([
      { t: 'snapshot', snapshot },
      { t: 'peer-joined', participant: { id: 'p2', name: 'Bob' } },
    ]);
    // duplicate peer-joined is deliberate dedupe; signal is handled by the rtc layer, not the reducer
    expect(
      roomReducer(s, { t: 'server', msg: { t: 'peer-joined', participant: { id: 'p2', name: 'Bob' } } }),
    ).toBe(s);
    expect(roomReducer(s, { t: 'server', msg: { t: 'signal', from: 'p2', data: {} } })).toBe(s);
  });
});
