/**
 * social — authenticated home layout + end-to-end text message (SPA, 8082).
 *
 * These drive the real Vue 3 SPA with a seeded session (a real SIWE-issued JWT
 * placed in sessionStorage before boot), landing directly on `#/home/...`.
 *
 * Env:
 *  - SOCIAL_WEB_URL       Vue 3 SPA (8082). Tests skip when unset.
 *  - SOCIAL_BASE_URL      platform backend (8888) — for API-side setup.
 *  - SOCIAL_IDENTITY_URL  web3-identity (8901) — mints the seeded session(s).
 *
 * The SPA dev-proxies /api -> 8888, so the seeded token authenticates its own
 * XHRs (Home.vue calls GET /user/self on mount; a 400 would redirect to `/`).
 */
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { newSiweIdentity, platformCtx } from '../helpers/auth';
import { seedSession } from '../helpers/session';

const spaURL = () => envFor('social')['SOCIAL_WEB_URL'];
const platformURL = () => baseURLFor('social');
const identityURL = () => envFor('social')['SOCIAL_IDENTITY_URL'];

function skipIfNoStack() {
  test.skip(
    !spaURL() || !platformURL() || !identityURL(),
    'SOCIAL_WEB_URL / SOCIAL_BASE_URL / SOCIAL_IDENTITY_URL required',
  );
}

// SO-UI-012 — seeded session lands on the chat home and renders the layout.
test("【前端导航与聊天界面 / E2E】 SO-UI-012 播种会话进入聊天主界面渲染布局", async ({ page }) => {
  skipIfNoStack();
  const user = await newSiweIdentity(platformURL()!, identityURL()!);
  await seedSession(page, user.login);

  await page.goto(`${spaURL()}/#/home/chat`);

  // Left nav bar with the three router-links (chat / friend / group).
  await expect(page.locator('.navi-bar')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.navi-bar .icon-chat')).toBeVisible();
  await expect(page.locator('.navi-bar .icon-friend')).toBeVisible();
  await expect(page.locator('.navi-bar .icon-group')).toBeVisible();
  // Bottom actions: settings + exit.
  await expect(page.locator('.navi-bar .icon-setting')).toBeVisible();
  await expect(page.locator('.navi-bar .icon-exit')).toBeVisible();
  // The chat router-view is mounted (the Chat view's search box container).
  await expect(page.locator('.content-box')).toBeVisible();
  // We stayed authenticated (no redirect back to /login).
  await expect(page).toHaveURL(/#\/home\/chat$/);
});

// SO-UI-017 — end-to-end: open a friend conversation, type, send, see the bubble.
test("【前端导航与聊天界面 / E2E】 SO-UI-017 端到端发送文本消息", async ({ page }) => {
  skipIfNoStack();
  test.slow(); // two SIWE logins + friend setup + SPA hydration
  // Set up two mutual friends via the API, then drive the UI as user A.
  const A = await newSiweIdentity(platformURL()!, identityURL()!);
  const B = await newSiweIdentity(platformURL()!, identityURL()!);
  const ctxA = await platformCtx(platformURL()!, A.login.accessToken);
  const ctxB = await platformCtx(platformURL()!, B.login.accessToken);
  try {
    await ctxA.post(`/friend/add?friendId=${B.userId}`);
    await ctxB.post(`/friend/add?friendId=${A.userId}`);
  } finally {
    await ctxA.dispose();
    await ctxB.dispose();
  }

  await seedSession(page, A.login);
  await page.goto(`${spaURL()}/#/home/friend`);

  // Friend B shows up in A's friend list; open its detail, then "发消息".
  const friendItem = page.locator('.friend-item').first();
  await expect(friendItem).toBeVisible({ timeout: 15_000 });
  await friendItem.click();

  const sendMsgBtn = page.getByRole('button', { name: '发消息' });
  await expect(sendMsgBtn).toBeVisible({ timeout: 10_000 });
  await sendMsgBtn.click();

  // Now on the chat view with B active; wait for the ChatBox, then type.
  await expect(page).toHaveURL(/#\/home\/chat$/);
  await expect(page.locator('.chat-box')).toBeVisible({ timeout: 10_000 });
  const editor = page.locator('.chat-input-area .edit-container');
  await expect(editor).toBeVisible({ timeout: 10_000 });
  const text = `e2e-msg-${Date.now() % 100000}`;
  await editor.click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');

  // The sent bubble is inserted optimistically into the ChatBox message list.
  await expect(page.locator('.chat-box .message-text', { hasText: text })).toBeVisible({
    timeout: 15_000,
  });
});
