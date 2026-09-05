import { describe, expect, test } from 'vitest';
import { extractVideoId, fetchTitle } from '../src/youtube';

describe('extractVideoId', () => {
  const ID = 'dQw4w9WgXcQ';
  test.each([
    [`https://www.youtube.com/watch?v=${ID}`, ID],
    [`https://youtube.com/watch?v=${ID}&t=42s`, ID],
    [`https://youtu.be/${ID}`, ID],
    [`https://youtu.be/${ID}?si=abc`, ID],
    [`https://www.youtube.com/shorts/${ID}`, ID],
    [`https://www.youtube.com/embed/${ID}`, ID],
    [`https://www.youtube.com/live/${ID}`, ID],
    [`https://music.youtube.com/watch?v=${ID}`, ID],
    [`  ${ID}  `, ID],
    ['https://vimeo.com/12345', null],
    ['not a url', null],
    ['https://youtube.com/watch?v=tooshort', null],
  ])('%s -> %s', (input, expected) => {
    expect(extractVideoId(input)).toBe(expected);
  });
});

describe('fetchTitle', () => {
  test('returns oEmbed title', async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ title: 'Never Gonna Give You Up' }), { status: 200 })) as typeof fetch;
    expect(await fetchTitle('dQw4w9WgXcQ', fake)).toBe('Never Gonna Give You Up');
  });
  test('falls back to videoId on non-200', async () => {
    const fake = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    expect(await fetchTitle('dQw4w9WgXcQ', fake)).toBe('dQw4w9WgXcQ');
  });
  test('falls back to videoId on network error', async () => {
    const fake = (async () => {
      throw new Error('boom');
    }) as typeof fetch;
    expect(await fetchTitle('dQw4w9WgXcQ', fake)).toBe('dQw4w9WgXcQ');
  });
});
