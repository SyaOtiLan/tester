/**
 * chat — Router token & top-up (CH-072..CH-076).
 *
 * Drives the real `/#/router` page behind a wallet UCAN login. The local
 * Router backend (ROUTER_BASE_URL) supplies public tokens + a model catalog.
 * Cases that need a funded/live token for an actual completion are out of
 * scope here; we assert the token list, selection persistence, usage/status
 * panel, and the top-up redirect boundary.
 */
import { test, expect, baseURLFor } from '../fixtures';
import { loginOrSkip, openRoute } from '../helpers/auth';
import { readPersistedState } from '../helpers/storage';

function skipNoService() {
  test.skip(!baseURLFor('chat'), 'CHAT_BASE_URL not configured');
}

async function openRouter(page: any, search = '') {
  await loginOrSkip(page);
  await openRoute(page, `/router${search}`);
  await expect(page.getByText('Community Router', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
}

// CH-072 — Router page lists available (public) tokens or an explicit empty state.
test("【Router 令牌与充值 / UI】 CH-072 Router 页展示可用令牌", async ({ page }) => {
  skipNoService();
  await openRouter(page);
  const tokenSection = page.locator('[data-router-section="token"]');
  await expect(tokenSection).toBeVisible();
  const select = tokenSection.locator('select');
  await expect(select).toBeVisible();
  // Either real token options are present, or the disabled "no tokens" state.
  const optionCount = await select.locator('option').count();
  expect(optionCount).toBeGreaterThan(0);
});

// CH-073 — selecting a token persists it into the access store.
test("【Router 令牌与充值 / E2E】 CH-073 选择令牌用于会话", async ({ page }) => {
  skipNoService();
  await openRouter(page);
  const select = page.locator('[data-router-section="token"] select');
  const isDisabled = await select.isDisabled();
  const values = await select.locator('option').evaluateAll((opts) =>
    (opts as HTMLOptionElement[]).map((o) => o.value).filter((v) => v.length > 0),
  );
  test.skip(
    isDisabled || values.length === 0,
    'no selectable public tokens returned by the Router backend — cannot exercise token selection',
  );
  await select.selectOption(values[0]);
  await expect
    .poll(async () => (await readPersistedState(page, 'access-control'))?.selectedRouterToken, {
      timeout: 5_000,
    })
    .toBe(values[0]);
});

// CH-074 — bootstrap auto-selects an available public token (ensureRouterToken).
test("【Router 令牌与充值 / E2E】 CH-074 自动挑选可用公共令牌(引导)", async ({ page }) => {
  skipNoService();
  await openRouter(page);
  // Give bootstrap a moment to resolve a token.
  await page.waitForTimeout(1500);
  const selected =
    (await readPersistedState(page, 'access-control'))?.selectedRouterToken || '';
  const options = await page
    .locator('[data-router-section="token"] select option')
    .evaluateAll((opts) =>
      (opts as HTMLOptionElement[]).map((o) => o.value).filter((v) => v.length > 0),
    );
  test.skip(
    options.length === 0,
    'no public tokens available from the Router backend — nothing to auto-pick',
  );
  // With tokens available, a token should be auto-selected on bootstrap.
  expect(selected.length).toBeGreaterThan(0);
});

// CH-075 — token usage / balance status panel is rendered.
test("【Router 令牌与充值 / UI】 CH-075 令牌用量/余额状态展示", async ({ page }) => {
  skipNoService();
  await openRouter(page);
  // Status panel exposes token name / available-quota / used-quota / expiry.
  const body = await page.locator('body').innerText();
  const labels = ['Available', 'Used', 'Token', 'Usage'];
  expect(labels.some((l) => body.includes(l))).toBeTruthy();
});

// CH-076 — the top-up action redirects to the Router management portal.
test("【Router 令牌与充值 / UI】 CH-076 充值/续费跳转管理中心", async ({ page, request }) => {
  skipNoService();
  const cfg = await (await request.get('/api/config')).json();
  const rechargeUrl: string =
    cfg.routerPortalRechargeUrl || cfg.routerPortalTokenUrl || cfg.routerPortalUrl || '';
  test.skip(!rechargeUrl, 'no routerPortal*Url configured — no recharge target to assert');

  await openRouter(page, '?action=recharge');
  // The recharge action banner surfaces a primary "Top Up" button that opens the
  // Router management portal in a new tab via window.open(url, "_blank"). We hook
  // window.open to capture the target URL — the portal host itself may not be
  // running in this environment, so asserting on a real popup load is unreliable.
  await page.evaluate(() => {
    (window as any).__opened = [];
    (window as any).open = (url: string) => {
      (window as any).__opened.push(url);
      return null;
    };
  });
  const topUp = page.getByRole('button', { name: /Top Up|充值/ }).first();
  await expect(topUp).toBeVisible({ timeout: 8_000 });
  await topUp.click();
  const host = new URL(rechargeUrl).host;
  await expect
    .poll(async () => page.evaluate(() => (window as any).__opened as string[]), { timeout: 5_000 })
    .toEqual(expect.arrayContaining([expect.stringContaining(host)]));
});
