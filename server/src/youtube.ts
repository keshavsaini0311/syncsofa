const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function extractVideoId(input: string): string | null {
  const s = input.trim();
  if (ID_RE.test(s)) return s;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^(www|m)\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return ID_RE.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const v = url.searchParams.get('v');
    if (v && ID_RE.test(v)) return v;
    const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
  }
  return null;
}

export async function fetchTitle(videoId: string, fetchFn: typeof fetch = fetch): Promise<string> {
  try {
    const res = await fetchFn(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://youtu.be/${videoId}`)}&format=json`,
    );
    if (!res.ok) return videoId;
    const data = (await res.json()) as { title?: unknown };
    return typeof data.title === 'string' ? data.title : videoId;
  } catch {
    return videoId;
  }
}
