/**
 * router — authenticated session navigation guards (RT-UI-013 / RT-UI-014).
 *
 *   - RT-UI-013: the header user dropdown's "退出/Logout" item calls
 *     `GET /api/v1/public/user/logout`, clears the `user` / `wallet_token`
 *     localStorage slots, and navigates back to `/login`
 *     (see `components/Header.jsx` `logout()`).
 *   - RT-UI-014: a normal-role user (role < 10 → `isAdmin()===false`) hitting an
 *     `/admin/*` route is bounced by `AdminOnlyRoute` to `/workspace/entry`,
 *     which then resolves to a workspace page — never staying on `/admin/*`.
 *
 * Both seed a real SIWE wallet session via `seedWalletSession`.
 * Verified against router `web/src/App.jsx` (`AdminOnlyRoute`, `isAdmin`) +
 * `web/src/components/Header.jsx`.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';

import { seedWalletSession } from '../helpers/session';

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}

// RT-UI-014 (P1)
test(localizedTitle("【管理后台与工作台 / UI】 普通用户点击 /admin/* 会被重定向到工作区", "a normal user hitting /admin/* is redirected to the workspace"), async ({
  page,
  baseURL,
  recorder,
}) => {
  skipIfNoService();
  const env = envFor('router');
  test.skip(!env['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');

  await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
  const session = await seedWalletSession(page, baseURL!, env['ROUTER_WALLET_PRIVATE_KEY']!);
  // The wallet account is a normal user (role < 10). Guard the precondition.
  expect(Number((session.user as { role?: number }).role ?? 0)).toBeLessThan(10);

  await page.goto(`${baseURL}/admin/dashboard`, { waitUntil: 'domcontentloaded' });
  // AdminOnlyRoute → /workspace/entry → a concrete workspace page. Either way
  // the user must be off /admin/* and on /workspace/*.
  await expect(page).toHaveURL(/\/workspace\//, { timeout: 15_000 });
  expect(page.url()).not.toContain('/admin/');
  await recorder.step(page, '普通用户访问 /admin/* 被重定向到工作台');
});

// RT-UI-013 (P1)
test(localizedTitle("【管理后台与工作台 / UI】 用户下拉注销会清除会话并返回到 /login", "the user dropdown Logout clears the session and returns to /login"), async ({
  page,
  baseURL,
  recorder,
}) => {
  skipIfNoService();
  const env = envFor('router');
  test.skip(!env['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');

  await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
  await seedWalletSession(page, baseURL!, env['ROUTER_WALLET_PRIVATE_KEY']!);

  await page.goto(`${baseURL}/workspace/token`, { waitUntil: 'domcontentloaded' });
  // The header user chip appears once the recovered session hydrates the context.
  const chip = page.locator('.router-header-toolbar-chip');
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await recorder.step(page, '已登录工作台');

  // Open the dropdown and click 退出/Logout → GET /user/logout fires.
  await chip.click();
  const [logoutRes] = await Promise.all([
    page.waitForResponse(
      r => r.url().includes('/api/v1/public/user/logout') && r.request().method() === 'GET',
      { timeout: 15_000 },
    ),
    page.getByRole('menuitem', { name: /退出|Logout/ }).click(),
  ]);
  expect(logoutRes.ok()).toBe(true);

  // Redirected to /login and the session slots are cleared.
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  const cleared = await page.evaluate(() => {
    const g = globalThis as unknown as { localStorage: Storage };
    return {
      user: g.localStorage.getItem('user'),
      walletToken: g.localStorage.getItem('wallet_token'),
    };
  });
  expect(cleared.user).toBeNull();
  expect(cleared.walletToken).toBeNull();
  await recorder.step(page, '退出后清理会话并回到登录页');
});
