/**
 * router — login page rendering + auth-mode switch (RT-UI-008 / 009 / 010).
 *
 * The login shell (`components/LoginForm.jsx`) defaults to `authMode='wallet'`
 * and renders `.router-wallet-button` + the `#login-title` heading. A corner
 * toggle `.router-login-mode-corner` switches to the passkey/identity mode,
 * which POSTs `/auth/identity/passkey/login/session` and renders an `AppQRCode`
 * plus a `.router-identity-local-link`.
 *
 * No wallet provider is injected in a headless Playwright context (no
 * `window.ethereum`), so provider detection settles to "unavailable" and the
 * `.router-auth-message` "未检测到钱包插件…" warning appears while the wallet
 * button stays disabled — exactly the no-extension precondition of RT-UI-010.
 *
 * Selectors verified against router `web/src/components/LoginForm.jsx`.
 */
import { test, expect, baseURLFor } from '../fixtures';

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}

// RT-UI-008 (P1)
test("【管理后台与工作台 / UI】 登录页面默认为钱包登录模式", async ({ page, baseURL, recorder }) => {
  skipIfNoService();
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.router-login-page')).toBeVisible({ timeout: 15_000 });
  // Default authMode='wallet' → the wallet button and the login title render.
  await expect(page.locator('.router-wallet-button')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#login-title')).toBeVisible();
  // Wallet mode, not identity: the passkey panel is absent.
  await expect(page.locator('.router-identity-login-panel')).toHaveCount(0);
  await recorder.step(page, '登录页默认钱包登录模式');
});

// RT-UI-010 (P1)
test("【管理后台与工作台 / UI】 未检测到钱包扩展时登录页面会发出警告", async ({ page, baseURL, recorder }) => {
  skipIfNoService();
  // Headless context has no injected wallet provider (`window.ethereum`).
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });

  // Once provider detection completes with nothing available, the warning
  // alert renders and the wallet button is disabled — no signature can start.
  await expect(page.locator('.router-auth-message')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.router-wallet-button')).toBeDisabled();
  await recorder.step(page, '未检测到钱包插件告警');
});

// RT-UI-009 (P1)
test("【管理后台与工作台 / UI】 切换到密钥模式会呈现 QR 登录面板", async ({ page, baseURL, recorder }) => {
  skipIfNoService();
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.router-login-mode-corner')).toBeVisible({ timeout: 15_000 });

  // Toggle to identity mode → the app POSTs a passkey login session and renders
  // the identity panel with a QR code + a local-open link.
  const [sessionRes] = await Promise.all([
    page.waitForResponse(
      r =>
        r.url().includes('/api/v1/public/auth/identity/passkey/login/session') &&
        r.request().method() === 'POST',
      { timeout: 15_000 },
    ),
    page.locator('.router-login-mode-corner').click(),
  ]);
  expect(sessionRes.ok()).toBe(true);

  await expect(page.locator('.router-identity-login-panel')).toBeVisible({ timeout: 15_000 });
  const localLink = page.locator('.router-identity-local-link');
  await expect(localLink).toBeVisible({ timeout: 15_000 });
  await expect(localLink).toHaveAttribute('href', /identity\/authorize\?requestId=/);
  await recorder.step(page, '切换到通行证模式渲染二维码');
});
