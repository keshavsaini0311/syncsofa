import { test, expect, type Page, type Browser } from '@playwright/test';

const VIDEO_URL = 'https://youtu.be/dQw4w9WgXcQ';
const VIDEO_URL_2 = 'https://www.youtube.com/watch?v=9bZkp7q19f0';

/** Creates a room as `name` and returns the page plus the room code. */
async function createRoom(browser: Browser, name: string): Promise<{ page: Page; code: string }> {
  const page = await browser.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a room' }).click();
  await page.waitForURL(/\/r\/[A-Z0-9]{6}$/);
  const code = page.url().split('/r/')[1];
  await joinAs(page, name);
  return { page, code };
}

/** Fills the name form on a room page and waits until the room UI is live. */
async function joinAs(page: Page, name: string): Promise<void> {
  await page.getByPlaceholder('Your name').fill(name);
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page.locator('.room-code')).toBeVisible();
  await expect(page.locator('.banner', { hasText: 'Connecting' })).toHaveCount(0);
}

/** Opens an existing room in a fresh context so it gets its own localStorage identity. */
async function joinRoom(browser: Browser, code: string, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/r/${code}`);
  await joinAs(page, name);
  return page;
}

test('a created room is joinable by a second person and presence reflects both', async ({ browser }) => {
  const { page: alice, code } = await createRoom(browser, 'Alice');
  await expect(alice.locator('.presence')).toHaveText('1 here');

  const bob = await joinRoom(browser, code, 'Bob');
  await expect(bob.locator('.presence')).toHaveText('2 here');
  await expect(alice.locator('.presence')).toHaveText('2 here');

  await bob.close();
  await expect(alice.locator('.presence')).toHaveText('1 here');
});

test('an unknown room code shows the not-found screen', async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto('/r/ZZZZZZ');
  await page.getByPlaceholder('Your name').fill('Ghost');
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page.getByText(/doesn’t exist/)).toBeVisible();
});

test('a playlist item added by one person appears for the other', async ({ browser }) => {
  const { page: alice, code } = await createRoom(browser, 'Alice');
  const bob = await joinRoom(browser, code, 'Bob');

  await alice.getByPlaceholder('Paste a YouTube link…').fill(VIDEO_URL);
  await alice.getByRole('button', { name: 'Add' }).click();

  // title comes from oEmbed, or falls back to the video id when offline — assert on the row, not the text
  await expect(alice.locator('.playlist li')).toHaveCount(1);
  await expect(bob.locator('.playlist li')).toHaveCount(1);
  await expect(bob.locator('.playlist li .by')).toHaveText('Alice');
});

test('a rejected url tells the adder and adds nothing', async ({ browser }) => {
  const { page: alice } = await createRoom(browser, 'Alice');
  await alice.getByPlaceholder('Paste a YouTube link…').fill('https://vimeo.com/12345');
  await alice.getByRole('button', { name: 'Add' }).click();
  await expect(alice.locator('.banner.error')).toBeVisible();
  await expect(alice.locator('.playlist li')).toHaveCount(0);
});

test('choosing a playlist item moves the current-item highlight for everyone', async ({ browser }) => {
  const { page: alice, code } = await createRoom(browser, 'Alice');
  const bob = await joinRoom(browser, code, 'Bob');

  for (const url of [VIDEO_URL, VIDEO_URL_2]) {
    await alice.getByPlaceholder('Paste a YouTube link…').fill(url);
    await alice.getByRole('button', { name: 'Add' }).click();
    await expect(alice.locator('.playlist li')).toHaveCount(url === VIDEO_URL ? 1 : 2);
  }

  // first added item became current for both
  await expect(alice.locator('.playlist li').first()).toHaveClass(/current/);
  await expect(bob.locator('.playlist li').first()).toHaveClass(/current/);

  // Bob jumps to the second item; Alice's highlight follows through the server
  await bob.locator('.playlist li').nth(1).locator('.title').click();
  await expect(bob.locator('.playlist li').nth(1)).toHaveClass(/current/);
  await expect(alice.locator('.playlist li').nth(1)).toHaveClass(/current/);
  await expect(alice.locator('.playlist li').first()).not.toHaveClass(/current/);
});

test('reordering and removing a playlist item propagates', async ({ browser }) => {
  const { page: alice, code } = await createRoom(browser, 'Alice');
  const bob = await joinRoom(browser, code, 'Bob');

  for (const url of [VIDEO_URL, VIDEO_URL_2]) {
    await alice.getByPlaceholder('Paste a YouTube link…').fill(url);
    await alice.getByRole('button', { name: 'Add' }).click();
  }
  await expect(bob.locator('.playlist li')).toHaveCount(2);

  const firstTitle = await bob.locator('.playlist li').first().locator('.title').innerText();
  await alice.locator('.playlist li').first().getByRole('button', { name: '↓' }).click();
  await expect(bob.locator('.playlist li').nth(1).locator('.title')).toHaveText(firstTitle);

  await alice.locator('.playlist li').first().getByRole('button', { name: '✕' }).click();
  await expect(bob.locator('.playlist li')).toHaveCount(1);
});

test('chat delivers both ways and survives a reload', async ({ browser }) => {
  const { page: alice, code } = await createRoom(browser, 'Alice');
  const bob = await joinRoom(browser, code, 'Bob');

  await alice.getByPlaceholder('Say something…').fill('hello sofa');
  await alice.getByRole('button', { name: 'Send' }).click();
  await expect(bob.locator('.chat-msg')).toContainText(['hello sofa']);

  await bob.getByPlaceholder('Say something…').fill('hi back');
  await bob.getByRole('button', { name: 'Send' }).click();
  await expect(alice.locator('.chat-msg')).toHaveCount(2);

  // history is persisted server-side, so a reload replays it
  await alice.reload();
  await expect(alice.locator('.chat-msg')).toHaveCount(2);
  await expect(alice.locator('.chat-msg').first()).toContainText('hello sofa');
});

test('a reaction floats on the other person’s screen then disappears', async ({ browser }) => {
  const { page: alice, code } = await createRoom(browser, 'Alice');
  const bob = await joinRoom(browser, code, 'Bob');

  await alice.locator('.reaction-bar button', { hasText: '🔥' }).click();
  await expect(bob.locator('.reaction-float')).toHaveCount(1);
  await expect(bob.locator('.reaction-float')).toContainText('Alice');
  // ephemeral by design — the reducer expires it after 3s
  await expect(bob.locator('.reaction-float')).toHaveCount(0, { timeout: 6000 });
});

test('a dropped connection recovers and the room still works', async ({ browser }) => {
  const { page: alice, code } = await createRoom(browser, 'Alice');
  const bob = await joinRoom(browser, code, 'Bob');

  await bob.evaluate(() => {
    // force the socket shut from the client side; RoomSocket must reconnect on its own
    for (const ws of (window as unknown as { __sockets?: WebSocket[] }).__sockets ?? []) ws.close();
  });

  await alice.getByPlaceholder('Say something…').fill('still there?');
  await alice.getByRole('button', { name: 'Send' }).click();
  await expect(bob.locator('.chat-msg')).toContainText(['still there?']);
});
