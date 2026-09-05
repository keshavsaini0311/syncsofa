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
    [`javascript://youtube.com/watch?v=${ID}`, null],
    [`file://youtube.com/watch?v=${ID}`, null],
    [`ftp://youtube.com/watch?v=${ID}`, null],
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
  test('falls back to videoId when title is not a string', async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ title: 42 }), { status: 200 })) as typeof fetch;
    expect(await fetchTitle('dQw4w9WgXcQ', fake)).toBe('dQw4w9WgXcQ');
  });
  test('falls back to videoId when the body is not an object', async () => {
    const fake = (async () => new Response('null', { status: 200 })) as typeof fetch;
    expect(await fetchTitle('dQw4w9WgXcQ', fake)).toBe('dQw4w9WgXcQ');
  });
  test('percent-encodes the video id into the oembed url', async () => {
    let requested = '';
    const fake = (async (input: RequestInfo | URL) => {
      requested = String(input);
      return new Response(JSON.stringify({ title: 'T' }), { status: 200 });
    }) as unknown as typeof fetch;
    await fetchTitle('dQw4w9WgXcQ', fake);
    expect(requested).toContain(encodeURIComponent('https://youtu.be/dQw4w9WgXcQ'));
  });
});
