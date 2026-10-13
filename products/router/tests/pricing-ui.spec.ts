/**
 * router — package purchase cards & the (unrouted) balance status page
 * (RT-UI-024 / RT-UI-025).
 *
 *   - RT-UI-024: the service-pricing page's `#pricing-package-section` mounts
 *     PackagePurchasePage, which renders a `.router-package-purchase-card` per
 *     purchasable subscription package (name / price / quota).
 *   - RT-UI-025: DEGRADED SKIP. BalanceStatusPage (`.router-topup-balance-layout`
 *     with the three 充值/兑换/赠送 `.router-topup-statistic` cards + the 兑换码充值
 *     entry) is dead code — no route in web/src/App.jsx mounts it. `/workspace/topup`
 *     always renders QuotaPage via TopUpLayout regardless of `?tab`, so the
 *     balance status layout is unreachable in this build.
 *
 * Selectors verified against router web/src/pages/ServicePricing/index.jsx,
 * web/src/pages/TopUp/PackagePurchasePage.jsx and BalanceStatusPage.jsx.
 */
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { seedWalletSession } from '../helpers/session';

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}

// RT-UI-024 (P2)
test("【pricing ui / UI】 定价页面呈现订阅套餐卡", async ({ page, baseURL, recorder }) => {
  skipIfNoService();
  test.skip(!envFor('router')['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');
  await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
  await seedWalletSession(page, baseURL!, envFor('router')['ROUTER_WALLET_PRIVATE_KEY']!);

  await page.goto(`${baseURL}/workspace/service/pricing`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#pricing-package-section')).toBeVisible({ timeout: 15_000 });

  const card = page.locator('.router-package-purchase-card').first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  // The card exposes the package name and price.
  await expect(card.locator('.router-package-purchase-card-title')).toBeVisible();
  await expect(card.locator('.router-package-purchase-price')).toBeVisible();
  await recorder.step(page, '套餐购买页展示订阅套餐卡片');
});

// RT-UI-025 (P2) — DEGRADED SKIP: BalanceStatusPage is unrouted dead code.
test("【余额与兑换码 / UI】 RT-UI-025 余额状态页显示三类余额", async () => {
  test.skip(
    true,
    'BalanceStatusPage (`.router-topup-balance-layout`) is not wired into web/src/App.jsx — ' +
      '/workspace/topup always renders QuotaPage via TopUpLayout regardless of ?tab, so the ' +
      'three-balance status layout is unreachable in this build',
  );
});
