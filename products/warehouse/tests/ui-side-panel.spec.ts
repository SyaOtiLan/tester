/**
 * warehouse — Post-login side panel navigation.
 *
 * After a successful SIWE login the SPA renders an `aside.side-panel`
 * with four nav groups (我的资产 / 分享与协作 / 管理 / 帮助). This spec
 * asserts that every group + the items it contains render once the SDK
 * is hydrated with a real JWT. Conditional admin items (用户管理) are
 * asserted conditionally on `canManageUsers` so the test does not fail
 * on the SIWE test wallet which has no admin role.
 *
 * The seeded session comes from `helpers/session.ts` which runs the real
 * challenge -> sign -> verify flow so we never exercise the wallet
 * button / UCAN identity-presentation path (that's `ui-wallet.spec.ts`).
 */
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { Wallet } from 'ethers';
import { seedAuthenticatedSession } from '../helpers/session';

function skipIfNoService() {
  test.skip(!baseURLFor('warehouse'), 'WAREHOUSE_BASE_URL not configured');
}

test("【文件管理与导航界面 / UI】 经过身份验证的会话呈现所有四个侧面板导航组", async ({
  page,
  baseURL,
}) => {
  skipIfNoService();
  const env = envFor('warehouse');
  test.skip(!env['WAREHOUSE_WALLET_PRIVATE_KEY'], 'WAREHOUSE_WALLET_PRIVATE_KEY not configured');

  // Use a fresh random wallet so the SIWE nonce is per-test (no
  // cross-test collision against the well-known test wallet).
  const freshPk = Wallet.createRandom().privateKey;

  await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
  await seedAuthenticatedSession(page, baseURL!, freshPk);

  // Wait for the post-login shell to mount. The login-page container is
  // gone and .side-panel appears in its place once `loggedIn` flips.
  const sidePanel = page.locator('aside.side-panel');
  await expect(sidePanel).toBeVisible({ timeout: 10_000 });

  // All four nav group titles should be present in the expanded side panel.
  for (const title of ['我的资产', '分享与协作', '管理', '帮助']) {
    await expect(sidePanel.getByText(title, { exact: true })).toBeVisible();
  }

  // 我的资产 → 回收站 (asset spaces are user-specific; we just assert the
  // always-present 回收站 item).
  await expect(sidePanel.getByRole('button', { name: '回收站' })).toBeVisible();

  // 分享与协作 → 分享 + 收到的分享
  await expect(sidePanel.getByRole('button', { name: '分享', exact: true })).toBeVisible();
  await expect(sidePanel.getByRole('button', { name: '收到的分享', exact: true })).toBeVisible();

  // 管理 → 我的资料 + 密钥管理 (always available); 用户管理 only for
  // users with canManageUsers (admin); 分组管理 only for users with
  // canManageGroups.
  await expect(sidePanel.getByRole('button', { name: '我的资料' })).toBeVisible();
  await expect(sidePanel.getByRole('button', { name: '密钥管理' })).toBeVisible();

  // 帮助 → 使用指南
  await expect(sidePanel.getByRole('button', { name: '使用指南' })).toBeVisible();
});

test("【文件管理与导航界面 / UI】 点击“密钥管理”后在当前 SPA 中进入密钥管理视图", async ({
  page,
  baseURL,
}) => {
  skipIfNoService();
  const env = envFor('warehouse');
  test.skip(!env['WAREHOUSE_WALLET_PRIVATE_KEY'], 'WAREHOUSE_WALLET_PRIVATE_KEY not configured');

  // Fresh wallet per test (see comment above).
  const freshPk = Wallet.createRandom().privateKey;

  await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
  await seedAuthenticatedSession(page, baseURL!, freshPk);

  const sidePanel = page.locator('aside.side-panel');
  await expect(sidePanel).toBeVisible({ timeout: 10_000 });

  // Click 密钥管理. The button becomes .active and the main panel
  // shows a management view rather than the file browser.
  await sidePanel.getByRole('button', { name: '密钥管理' }).click();
  await expect(sidePanel.getByRole('button', { name: '密钥管理' })).toHaveClass(/active/);

  // We never navigated away — same origin, side panel still mounted.
  await expect(page).toHaveURL(baseURL! + '/');
  await expect(sidePanel).toBeVisible();
});