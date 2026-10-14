/**
 * node — real-wallet SIWE login + route-guard behavior (E2E/UI).
 *
 * ND-E2E-006 drives the actual UI login: an injected EIP-1193 wallet
 * (`injectWallet`, isYeYing shim + Node-side ethers signer) answers the
 * connect → challenge → personal_sign → verify round trip that the
 * `连接钱包` button kicks off, and the app then routes into `/market`.
 *
 * ND-E2E-007 checks the router guard (`setupRouter` beforeEach): a protected
 * route with no session is bounced to `/`, and clearing the session (logout
 * equivalent) re-arms the guard while the public home page stays reachable.
 *
 * Selectors verified against node `web/src/components/layout/Header.vue`,
 * `web/src/router/index.ts`, and `web/src/plugins/auth.ts`.
 */
import { localizedTitle } from '../../../shared/title';
import { Wallet } from 'ethers';

import { test, expect, baseURLFor, envFor } from '../fixtures';
import { injectWallet } from '../helpers/wallet';
import { seedWalletSession } from '../helpers/session';

function skipIfNoService() {
  test.skip(!baseURLFor('node'), 'NODE_BASE_URL not configured');
}

test(localizedTitle("【会话与鉴权守卫 / E2E】 ND-E2E-006 通过真实钱包完成 SIWE 登录", "ND-E2E-006 real wallet completes SIWE login and enters the marketplace"), async ({
  page,
  recorder,
}) => {
  skipIfNoService();
  const baseURL = baseURLFor('node')!;

  // Fresh throwaway wallet, injected before the first navigation so the shim
  // and exposed signer are present on load.
  const freshPk = Wallet.createRandom().privateKey;
  await injectWallet(page, freshPk);

  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });

  // The header's connect button drives connectWallet() → loginWithSiwe().
  await page.getByRole('button', { name: '连接钱包' }).click();
  await recorder.step(page, '点击连接钱包，触发 SIWE 登录');

  // Successful login routes into /market and writes the access JWT.
  await expect(page).toHaveURL(/\/market/, { timeout: 20_000 });
  const token = await page.evaluate(() => globalThis.localStorage.getItem('authToken'));
  expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  await recorder.step(page, 'SIWE 登录成功，进入应用市场');

  // The seeded session must satisfy profile/me with the wallet's own address.
  const meAddress = await page.evaluate(async (t) => {
    const res = await fetch('/api/v1/public/profile/me', {
      headers: { Authorization: `Bearer ${t}` },
    });
    const body = (await res.json()) as { data?: { address?: string } };
    return body?.data?.address as string;
  }, token);
  expect(meAddress.toLowerCase()).toBe(new Wallet(freshPk).address.toLowerCase());

  // Protected route is reachable now that we're authenticated.
  await page.goto(`${baseURL}/market/dev/my-apps`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab', { name: '我创建的' })).toBeVisible({ timeout: 15_000 });
  await recorder.step(page, '登录后可进入受保护的「我的应用」');
});

test(localizedTitle("【会话与鉴权守卫 / E2E】 ND-E2E-007 未登录访问受保护路由被重定向,登出后守卫生效", "ND-E2E-007 protected routes redirect without a session and after logout"), async ({
  page,
  recorder,
}) => {
  skipIfNoService();
  test.skip(!envFor('node')['NODE_WALLET_PRIVATE_KEY'], 'node wallet env not configured');
  const baseURL = baseURLFor('node')!;

  // 1) No session → the guard bounces a protected route back to home.
  await page.goto(`${baseURL}/market/dev/my-apps`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new RegExp(`^${baseURL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`), {
    timeout: 15_000,
  });
  await recorder.step(page, '无会话访问受保护路由被重定向回首页');

  // 2) Seed a real session → the protected route is reachable.
  await seedWalletSession(page, baseURL, envFor('node')['NODE_WALLET_PRIVATE_KEY']!);
  await page.goto(`${baseURL}/market/dev/my-apps`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab', { name: '我创建的' })).toBeVisible({ timeout: 15_000 });
  await recorder.step(page, '已登录可访问受保护路由');

  // 3) Logout equivalent (clear the stored session) → guard re-arms.
  await page.evaluate(() => globalThis.localStorage.clear());
  await page.goto(`${baseURL}/market/dev/my-apps`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new RegExp(`^${baseURL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`), {
    timeout: 15_000,
  });
  // The public home page still renders after the guard bounce.
  await expect(page.locator('body')).toBeVisible();
  await recorder.step(page, '登出后受保护路由再次被拦截,首页仍可访问');
});
