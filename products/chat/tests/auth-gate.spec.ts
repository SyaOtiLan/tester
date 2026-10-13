/**
 * chat — auth / login gate (CH-008..CH-015).
 *
 * Login is a REAL wallet-SIWE (UCAN) flow driven through the app's own auth
 * page with an injected EIP-1193 shim (helpers/chat-wallet.ts). We never fake an
 * authenticated session; when a live flow cannot run we skip with a reason.
 */
import { test, expect, baseURLFor } from '../fixtures';
import { injectChatWallet, freshWalletKey } from '../helpers/chat-wallet';
import { loginWithWallet, isAuthorized, AUTH_CONNECT, SIDEBAR } from '../helpers/chat-auth';
import { Wallet } from 'ethers';

function skipIfNoService() {
  test.skip(!baseURLFor('chat'), 'CHAT_BASE_URL not configured');
}

// Login drives a live SIWE + workspace-sync bootstrap; the WebDAV sync step is
// occasionally flaky per fresh wallet, so allow a couple of retries (each retry
// uses a new wallet).
test.describe.configure({ retries: 2 });

// CH-008 — unauthenticated protected routes redirect to /auth?redirect=<path>.
test("【鉴权与登录准入 / E2E】 CH-008 未登录访问受保护路由重定向到 /auth", async ({ page }) => {
  skipIfNoService();
  for (const target of ['/#/chat', '/#/settings']) {
    await page.goto(target);
    await expect
      .poll(() => page.url(), { timeout: 10_000 })
      .toMatch(/#\/auth\?redirect=/);
  }
});

// CH-009 — auth page renders wallet account input, clear affordance, and history.
test("【鉴权与登录准入 / UI】 CH-009 登录页展示钱包账号选择与历史", async ({ page }) => {
  skipIfNoService();
  await page.goto('/#/auth');
  const input = page.locator('input[class*="auth-wallet-select"]');
  await expect(input).toBeVisible();
  // Clear button only appears once an account is entered/selected.
  await input.fill(Wallet.createRandom().address);
  await expect(page.locator('[class*="auth-wallet-clear"]')).toBeVisible();
  // Opening the account list with no history shows the empty-state text.
  await page.locator('[class*="auth-wallet-clear"]').click();
  await page.locator('[class*="auth-wallet-arrow-button"]').click();
  await expect(page.locator('[class*="auth-wallet-history-empty"]')).toBeVisible();
});

// CH-010 — with no wallet present, detection records hasConnectedWallet=false and
// the page does not crash. When force-wallet mode is configured, a wallet-missing
// notice is also expected.
test("【鉴权与登录准入 / UI】 CH-010 强制钱包模式下未检测到钱包给出提示", async ({ page, request }) => {
  skipIfNoService();
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('hasConnectedWallet')), { timeout: 10_000 })
    .toBe('false');
  // No crash: an interactive login affordance is still present.
  await page.goto('/#/auth');
  await expect(page.locator(AUTH_CONNECT).first()).toBeVisible();

  const cfg = await (await request.get('/api/config')).json();
  if (cfg.ucanLoginForceMode === 'wallet') {
    // Forced wallet mode surfaces a "no wallet detected" notice.
    await expect(page.getByText(/未检测到钱包|no wallet|wallet.*not.*detect/i).first()).toBeVisible({
      timeout: 10_000,
    });
  } else {
    test.info().annotations.push({
      type: 'note',
      description: `ucanLoginForceMode="${cfg.ucanLoginForceMode}" (not "wallet"); forced-mode notice not asserted.`,
    });
  }
});

// CH-011 — wallet SIWE login establishes a valid authorization and enters the app.
test("【鉴权与登录准入 / E2E】 CH-011 钱包 SIWE 登录成功后进入应用", async ({ page }) => {
  skipIfNoService();
  test.setTimeout(90_000);
  await loginWithWallet(page);
  expect(await isAuthorized(page)).toBe(true);
  expect(page.url()).not.toMatch(/#\/auth(\?|$)/);
  await expect(page.locator(SIDEBAR).first()).toBeVisible();
});

// CH-012 — central UCAN passport login.
test("【鉴权与登录准入 / E2E】 CH-012 中心化通行证(central UCAN)登录链路", async () => {
  test.skip(
    true,
    'central UCAN login redirects to an external passport authorize page and requires an interactive session + callback that cannot be automated here (no live central session/credentials).',
  );
});

// CH-013 — wallet account mismatch surfaces a decision dialog.
test("【鉴权与登录准入 / UI】 CH-013 钱包账户与应用账户不一致时给出选择", async ({ page }) => {
  skipIfNoService();
  test.setTimeout(60_000);
  await injectChatWallet(page, freshWalletKey());
  await page.goto('/#/auth');
  // Ask to sign in as a DIFFERENT address than the injected wallet holds.
  const bogus = Wallet.createRandom().address;
  const input = page.locator('input[class*="auth-wallet-select"]');
  await input.fill(bogus);
  await input.blur();
  await page.locator(AUTH_CONNECT).first().click();
  await expect(page.getByText(/钱包账户不一致|wallet account mismatch/i).first()).toBeVisible({
    timeout: 15_000,
  });
});

// CH-014 — an already-logged-in visit to /auth?redirect=<target> jumps to target.
test("【鉴权与登录准入 / E2E】 CH-014 已登录访问 /auth 自动跳回目标页", async ({ page }) => {
  skipIfNoService();
  test.setTimeout(90_000);
  await loginWithWallet(page);
  await page.goto('/#/auth?redirect=%2Fsettings');
  await expect.poll(() => page.url(), { timeout: 15_000 }).toMatch(/#\/settings(\?|$)/);
});

// CH-015 — logout clears the local UCAN session and returns to the auth gate.
test("【鉴权与登录准入 / E2E】 CH-015 退出登录清除本地授权会话", async ({ page }) => {
  skipIfNoService();
  test.setTimeout(90_000);
  await loginWithWallet(page);
  await page.goto('/#/settings');
  await page.getByRole('button', { name: /sign out|退出登录|退出/i }).first().click();
  await expect.poll(() => page.url(), { timeout: 15_000 }).toMatch(/#\/auth(\?|$)/);
  expect(await isAuthorized(page)).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('currentAccount'))).toBeNull();
});
