import { test, expect, type Page } from '@playwright/test';

/** True once the <video> has a live MediaStream with at least one video track. */
async function tileHasLiveStream(page: Page, index: number): Promise<boolean> {
  return page.evaluate((i) => {
    const v = document.querySelectorAll('.tile video')[i] as HTMLVideoElement | undefined;
    const stream = v?.srcObject as MediaStream | null;
    return !!stream && stream.getVideoTracks().some((t) => t.readyState === 'live');
  }, index);
}

test('each person sees their own camera and the other person’s', async ({ browser }) => {
  const alicePage = await browser.newPage();
  await alicePage.goto('/');
  await alicePage.getByRole('button', { name: 'Create a room' }).click();
  await alicePage.waitForURL(/\/r\/[A-Z0-9]{6}$/);
  const code = alicePage.url().split('/r/')[1];
  await alicePage.getByPlaceholder('Your name').fill('Alice');
  await alicePage.getByRole('button', { name: 'Join' }).click();

  // own tile appears with the fake camera attached
  await expect(alicePage.locator('.tile')).toHaveCount(1);
  await expect.poll(() => tileHasLiveStream(alicePage, 0)).toBe(true);

  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await bobPage.goto(`/r/${code}`);
  await bobPage.getByPlaceholder('Your name').fill('Bob');
  await bobPage.getByRole('button', { name: 'Join' }).click();

  // two tiles each: self + peer
  await expect(alicePage.locator('.tile')).toHaveCount(2);
  await expect(bobPage.locator('.tile')).toHaveCount(2);
  await expect(alicePage.locator('.tile-name').nth(1)).toHaveText('Bob');
  await expect(bobPage.locator('.tile-name').nth(1)).toHaveText('Alice');

  // the remote tile carries a real negotiated stream — this is the WebRTC mesh working
  await expect.poll(() => tileHasLiveStream(alicePage, 1), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => tileHasLiveStream(bobPage, 1), { timeout: 20_000 }).toBe(true);

  // leaving tears the peer tile down
  await bobPage.close();
  await expect(alicePage.locator('.tile')).toHaveCount(1);
});

test('muting the mic disables the outgoing audio track without dropping the call', async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a room' }).click();
  await page.waitForURL(/\/r\/[A-Z0-9]{6}$/);
  await page.getByPlaceholder('Your name').fill('Alice');
  await page.getByRole('button', { name: 'Join' }).click();
  await expect.poll(() => tileHasLiveStream(page, 0)).toBe(true);

  const audioEnabled = () =>
    page.evaluate(() => {
      const v = document.querySelector('.tile video') as HTMLVideoElement;
      return ((v.srcObject as MediaStream).getAudioTracks()[0] ?? { enabled: null }).enabled;
    });

  expect(await audioEnabled()).toBe(true);
  await page.locator('.call-controls button').first().click();
  expect(await audioEnabled()).toBe(false);
  // the stream itself is untouched — muting must not renegotiate or drop the call
  expect(await tileHasLiveStream(page, 0)).toBe(true);
});
