/**
 * node — notification center (API + UI).
 *
 * ND-API-033 exercises the notification read model end to end: creating an
 * application emits notifications, so a fresh wallet that creates one then
 * sees a non-empty list, a matching unread count, and a working read-all
 * that zeroes the unread counter.
 *
 * ND-UI-010 confirms `/market/dev/notifications` renders the notification
 * center shell for a seeded session.
 *
 * Selectors/contract verified against node `src/routes/public/notifications.ts`
 * and `web/src/views/apply/NotificationCenterView.vue`.
 */
import { localizedTitle } from '../../../shared/title';
import { Wallet, getAddress } from 'ethers';

import { test, expect, baseURLFor, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';
import { loginWithWallet } from '../helpers/auth';
import { seedWalletSession } from '../helpers/session';
import { buildCreateApplicationBody, deleteBody } from '../helpers/signedAction';

function skipIfNoService() {
  test.skip(!baseURLFor('node'), 'NODE_BASE_URL not configured');
}

test(localizedTitle("【通知中心 / API】 ND-API-033 通知列表、未读数与标记已读", "ND-API-033 notification list, unread-count and read-all stay consistent"), async () => {
  skipIfNoService();
  test.skip(!envFor('node')['NODE_WALLET_PRIVATE_KEY'], 'node wallet env not configured');
  const baseURL = baseURLFor('node')!;

  const wallet = Wallet.createRandom();
  const address = getAddress(wallet.address);
  const tokens = await loginWithWallet(baseURL, wallet.privateKey);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${tokens.token}` });
  try {
    // Creating an application emits an "application created" notification.
    const req = await buildCreateApplicationBody(wallet, address);
    const created = await ctx.post('/api/v1/public/applications', { data: req.body });
    expect(created.status(), await created.text().catch(() => '')).toBe(200);
    const uid = ((await created.json()) as { data: { uid: string } }).data.uid;

    const list = await ctx.get('/api/v1/public/notifications');
    expect(list.status()).toBe(200);
    const listBody = (await list.json()) as { data: { items?: unknown[] } };
    expect(Array.isArray(listBody.data.items)).toBe(true);
    expect(listBody.data.items!.length).toBeGreaterThan(0);

    const unread = await ctx.get('/api/v1/public/notifications/unread-count');
    expect(unread.status()).toBe(200);
    const unreadCount = ((await unread.json()) as { data: { unreadCount: number } }).data.unreadCount;
    expect(unreadCount).toBeGreaterThan(0);

    const readAll = await ctx.post('/api/v1/public/notifications/read-all', { data: {} });
    expect(readAll.status()).toBe(200);

    const unreadAfter = await ctx.get('/api/v1/public/notifications/unread-count');
    expect(((await unreadAfter.json()) as { data: { unreadCount: number } }).data.unreadCount).toBe(0);

    await ctx.delete(`/api/v1/public/applications/${uid}`, {
      data: await deleteBody(wallet, address, uid),
    });
  } finally {
    await ctx.dispose();
  }
});

test(localizedTitle("【通知中心 / UI】 ND-UI-010 通知中心页面渲染", "ND-UI-010 notification center renders for a seeded session"), async ({ page, recorder }) => {
  skipIfNoService();
  test.skip(!envFor('node')['NODE_WALLET_PRIVATE_KEY'], 'node wallet env not configured');
  const baseURL = baseURLFor('node')!;

  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await seedWalletSession(page, baseURL, envFor('node')['NODE_WALLET_PRIVATE_KEY']!);

  await page.goto(`${baseURL}/market/dev/notifications`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.notification-center')).toBeVisible({ timeout: 15_000 });
  await recorder.step(page, '通知中心渲染');
});
