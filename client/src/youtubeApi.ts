/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<any> | null = null;
export function loadYT(): Promise<any> {
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      if (window.YT?.Player) return resolve(window.YT);
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.onerror = () => reject(new Error('failed to load the YouTube IFrame API'));
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      // ponytail: plain timeout, no retry — a blocked script does not recover on its own
      setTimeout(() => reject(new Error('YouTube IFrame API timed out')), 10_000);
    });
    // let a later mount try again rather than caching the failure forever
    apiPromise.catch(() => {
      apiPromise = null;
    });
  }
  return apiPromise;
}
