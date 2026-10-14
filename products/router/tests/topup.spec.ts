/**
 * router — top-up order-creation boundary (NO real payment).
 *
 * Per the agreed scope, top-up is exercised only to the order-creation
 * boundary: click 立即充值, assert the app opens the payment popup and fires
 * `POST /api/v1/public/user/topup/orders`, then stop. No real payment gateway
 * is reached — the order POST is stubbed to return a pending order whose
 * `redirect_url` is `about:blank`, so the popup navigates nowhere real.
 *
 * Two reads are stubbed so the boundary is deterministic:
 *   - GET  /user/topup/plans  → one synthetic plan (so a 立即充值 card renders)
 *   - POST /user/topup/orders → { success, data:{ status:'pending',
 *                                 redirect_url:'about:blank' } }
 *
 * Click sequence verified in router `web/src/pages/TopUp/provider.jsx`:
 * `window.open('', '_blank')` fires FIRST, then the POST, then
 * `popup.location.href = data.redirect_url`. A non-paid status keeps the code
 * on the redirect branch (a paid status would close the popup instead).
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';

import { seedWalletSession } from '../helpers/session';

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}

test(localizedTitle("【令牌、充值与余额 / UI】 立即充值打开付款弹出窗口并创建订单（仅限边界）", "立即充值 opens the payment popup and creates an order (boundary only)"), async ({
  page,
  baseURL,
  recorder,
}) => {
  skipIfNoService();
  const env = envFor('router');
  test.skip(!env['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');

  // A synthetic plan so at least one 立即充值 card renders regardless of the
  // account's real catalogue.
  await page.route('**/api/v1/public/user/topup/plans*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '',
        data: [
          {
            id: 'e2e-plan',
            name: 'E2E 充值套餐',
            amount: 10,
            amount_currency: 'CNY',
            quota_amount: 10,
            quota_currency: 'USD',
            validity_days: 0,
            supported_models: [],
          },
        ],
      }),
    });
  });

  // Stub the order creation so no real payment gateway is touched. Pending
  // status + about:blank redirect keeps the flow on the redirect branch.
  let orderPostCount = 0;
  let orderBody: Record<string, unknown> = {};
  await page.route('**/api/v1/public/user/topup/orders', async route => {
    orderPostCount += 1;
    orderBody = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '',
        data: {
          id: 'e2e-order',
          transaction_id: 'e2e-tx',
          status: 'pending',
          redirect_url: 'about:blank',
          created_at: 0,
        },
      }),
    });
  });

  await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
  await seedWalletSession(page, baseURL!, env['ROUTER_WALLET_PRIVATE_KEY']!);

  await page.goto(`${baseURL}/workspace/service/pricing`, { waitUntil: 'domcontentloaded' });

  const card = page.locator('.router-balance-topup-card').first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await recorder.step(page, '充值套餐卡片');

  // Click 立即充值 → the app opens a popup first, then POSTs the order.
  const [popup, orderRes] = await Promise.all([
    page.waitForEvent('popup', { timeout: 15_000 }),
    page.waitForResponse(
      r =>
        r.url().includes('/api/v1/public/user/topup/orders') && r.request().method() === 'POST',
      { timeout: 15_000 },
    ),
    card.getByRole('button', { name: /立即充值|Top Up Now/ }).click(),
  ]);

  // Boundary assertions: popup opened, order POST fired with the right body,
  // stubbed order came back pending. No real payment beyond this point.
  expect(popup).toBeTruthy();
  expect(orderPostCount).toBe(1);
  expect(orderBody['business_type']).toBe('balance_topup');
  expect(orderBody['plan_id']).toBe('e2e-plan');
  expect(orderRes.ok()).toBe(true);
  await recorder.step(page, '已创建订单并打开支付弹窗（到下单边界为止）');

  await popup.close().catch(() => {});
});
