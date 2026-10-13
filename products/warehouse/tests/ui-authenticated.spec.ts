/**
 * warehouse — Post-login UI state in the browser.
 *
 * Runs the classical SIWE flow (challenge -> sign -> verify) inside the
 * browser to obtain a real JWT bound to a wallet address, then writes the
 * JWT into the SDK's storage (authToken cookie + localStorage entries +
 * the SDK's own token slot) so the frontend's `isAuth` returns true on
 * reload.
 *
 * This proves the entire post-login UX is wired correctly (AppHeader
 * state, isAuth reactivity, task button + avatar) without depending on
 * the full UCAN identity-presentation flow used by the wallet button
 * itself (which the warehouse SDK builds from a live wallet; that path
 * is exercised manually + by the warehouse backend integration tests).
 *
 * Side-panel nav groups are covered separately in `ui-side-panel.spec.ts`
 * to keep each spec focused on one slice of the post-login UI.
 */
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { Wallet } from 'ethers';
import { seedAuthenticatedSession } from '../helpers/session';

function skipIfNoService() {
  test.skip(!baseURLFor('warehouse'), 'WAREHOUSE_BASE_URL not configured');
}

test("【文件管理与导航界面 / E2E】 经过身份验证的浏览器会话呈现 AppHeader 登录后 UI", async ({
  page,
  context,
  baseURL,
}) => {
  skipIfNoService();
  const env = envFor('warehouse');
  test.skip(!env['WAREHOUSE_WALLET_PRIVATE_KEY'], 'WAREHOUSE_WALLET_PRIVATE_KEY not configured');

  // Fresh random wallet per test so the SIWE nonce is per-test (no
  // cross-test collision against the well-known test wallet or against
  // other parallel UI tests).
  const freshPk = Wallet.createRandom().privateKey;

  await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
  const seeded = await seedAuthenticatedSession(page, baseURL!, freshPk);

  expect(seeded.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  // Post-login UI: the landing-page buttons are gone.
  await expect(page.getByRole('button', { name: '钱包登录' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '通行证登录' })).toHaveCount(0);

  // AppHeader shows the task button (always present after auth).
  await expect(page.locator('.right .task-button').first()).toBeVisible({ timeout: 10_000 });

  // Confirm the SDK stored the wallet address back into localStorage.
  const stored = await page.evaluate(() => localStorage.getItem('walletAddress'));
  expect(stored?.toLowerCase()).toBe(seeded.address.toLowerCase());

  // The cookie persisted across the reload.
  const cookies = await context.cookies(baseURL!);
  expect(cookies.find((c) => c.name === 'authToken')?.value).toBeTruthy();
});