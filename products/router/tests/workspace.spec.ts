/**
 * router — authenticated workspace read surfaces.
 *
 * With a seeded wallet session (real SIWE token in localStorage), the three
 * primary workspace pages a user lands on all render behind `PrivateRoute`.
 * This spec proves each one mounts its distinctive content:
 *
 *   - /workspace/topup?tab=quota → quota stat cards (.router-topup-statistic)
 *   - /workspace/token           → the tokens table + 新增令牌 button
 *   - /workspace/log             → the user's own call log (.router-log-table)
 *
 * These are read-only; the token create/delete loop lives in
 * `token-lifecycle.spec.ts` and topup in `topup.spec.ts`.
 *
 * Selectors verified against router `web/src/pages/**` + `web/src/App.jsx`.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';

import { seedWalletSession } from '../helpers/session';

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}

test(localizedTitle("【管理后台与工作台 / UI】 为经过身份验证的用户呈现工作区配额、令牌和日志页面", "workspace quota, token and log pages render for an authenticated user"), async ({
  page,
  baseURL,
  recorder,
}) => {
  skipIfNoService();
  const env = envFor('router');
  test.skip(!env['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');

  await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
  await seedWalletSession(page, baseURL!, env['ROUTER_WALLET_PRIVATE_KEY']!);

  // --- 额度总览 (quota) ----------------------------------------------------
  await page.goto(`${baseURL}/workspace/topup?tab=quota`, { waitUntil: 'domcontentloaded' });
  // QuotaPage now renders 5 stat cards (total / used / remaining / tokens / recent
  // requests). At least 3 must mount for the page to be considered loaded.
  await expect(page.locator('.router-topup-statistic').first()).toBeVisible({ timeout: 15_000 });
  expect(await page.locator('.router-topup-statistic').count()).toBeGreaterThanOrEqual(3);
  await recorder.step(page, '工作台 · 额度总览');

  // --- 令牌 (tokens) -------------------------------------------------------
  await page.goto(`${baseURL}/workspace/token`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.router-list-table')).toBeVisible({ timeout: 15_000 });
  // The UI language follows the browser locale (zh fallback / en when the
  // browser reports en-US), so match either label. Two "Add Token" buttons can
  // exist (page header + empty-table CTA); the page-level one is first.
  await expect(page.getByRole('button', { name: /新增令牌|Add Token/ }).first()).toBeVisible();
  await recorder.step(page, '工作台 · 令牌列表');

  // --- 日志 (logs) ---------------------------------------------------------
  await page.goto(`${baseURL}/workspace/log`, { waitUntil: 'domcontentloaded' });
  // On the user-scoped /workspace/log the 路由异常概览 ranking is admin-only and
  // hidden; the page renders the user's own call log (LogsTable → `.router-log-table`).
  await expect(page.locator('.router-log-table').first()).toBeVisible({ timeout: 15_000 });
  await recorder.step(page, '工作台 · 个人调用日志');
});

// RT-UI-021 (P1) — service-purchase page renders the package + balance sections.
test(localizedTitle("【管理后台与工作台 / UI】 服务购买页面呈现套餐和余额部分", "service-purchase page renders the package and balance sections"), async ({
  page,
  baseURL,
  recorder,
}) => {
  skipIfNoService();
  const env = envFor('router');
  test.skip(!env['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');

  await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
  await seedWalletSession(page, baseURL!, env['ROUTER_WALLET_PRIVATE_KEY']!);

  await page.goto(`${baseURL}/workspace/service/pricing`, { waitUntil: 'domcontentloaded' });

  // Both region wrappers always render (ServicePricing/index.jsx), plus the
  // payment-history link is now a tab on the same page.
  await expect(page.locator('#pricing-package-section')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#pricing-balance-section')).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole('tab', { name: /支付记录|Payment Records/ }).first(),
  ).toBeVisible();
  await recorder.step(page, '服务购买页 · 套餐区与余额充值区');
});
