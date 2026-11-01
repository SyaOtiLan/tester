/**
 * router — login page rendering + auth-mode switch (RT-UI-008 / 009 / 010).
 *
 * The login shell (`components/LoginForm.jsx`) defaults to `authMode='wallet'`
 * and renders `.router-wallet-button` + the `#login-title` heading. A mode
 * switch `.router-login-mode-switch` switches to the passkey/identity mode,
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
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}

// RT-UI-008 (P1)
test(
  localizedTitle(
    '【管理后台与工作台 / UI】 登录页面默认为钱包登录模式',
    'login page defaults to wallet-login mode',
  ),
  async ({ page, baseURL, recorder }) => {
    skipIfNoService();
    await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('.router-login-page')).toBeVisible({ timeout: 15_000 });
    // Default authMode='wallet' → the wallet button and the login title render.
    await expect(page.locator('.router-wallet-button')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#login-title')).toBeVisible();
    // Wallet mode, not identity: the passkey panel is absent.
    await expect(page.locator('.router-identity-login-panel')).toHaveCount(0);
    await recorder.step(page, '登录页默认钱包登录模式');
  },
);

// RT-UI-010 (P1)
test(
  localizedTitle(
    '【管理后台与工作台 / UI】 未检测到钱包扩展时登录页面会发出警告',
    'login page warns when no wallet extension is detected',
  ),
  async ({ page, baseURL, recorder }) => {
    skipIfNoService();
    // Headless context has no injected wallet provider (`window.ethereum`).
    await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });

    // Once provider detection completes with nothing available, the warning
    // alert renders and the wallet button is disabled — no signature can start.
    await expect(page.locator('.router-auth-message')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.router-wallet-button')).toBeDisabled();
    await recorder.step(page, '未检测到钱包插件告警');
  },
);

// RT-UI-009 (P1)
test(
  localizedTitle(
    '【管理后台与工作台 / UI】 切换到密钥模式会呈现 QR 登录面板',
    'switching to passkey mode renders the QR login panel',
  ),
  async ({ page, baseURL, recorder }) => {
    skipIfNoService();
    await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.router-login-mode-switch')).toBeVisible({ timeout: 15_000 });

    // Toggle to identity mode → the app POSTs a passkey login session and renders
    // the identity panel with a QR code + a local-open link.
    const [sessionRes] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/public/auth/identity/passkey/login/session') &&
          r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      page.locator('.router-login-mode-switch').click(),
    ]);
    expect(sessionRes.ok()).toBe(true);

    await expect(page.locator('.router-identity-login-panel')).toBeVisible({ timeout: 15_000 });
    const localLink = page.locator('.router-identity-local-link');
    await expect(localLink).toBeVisible({ timeout: 15_000 });
    await expect(localLink).toHaveAttribute('href', /identity\/authorize\?requestId=/);
    await recorder.step(page, '切换到通行证模式渲染二维码');
  },
);

// RT-UI-032 (P1)
test(
  localizedTitle(
    '【管理后台与工作台 / UI】 通行证状态轮询遇到 429 后会停止重试',
    'passkey status polling stops after a 429 response',
  ),
  async ({ page, baseURL, recorder }) => {
    skipIfNoService();
    let statusPolls = 0;
    await page.route('**/api/v1/public/auth/identity/passkey/login/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            session_id: 'e2e-passkey-session',
            verify_url: 'https://node.example.test/identity/authorize?requestId=e2e',
            poll_interval: 0.1,
          },
        }),
      });
    });
    await page.route('**/api/v1/public/auth/identity/passkey/login/status?*', async (route) => {
      statusPolls += 1;
      if (statusPolls === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { status: 'pending' } }),
        });
        return;
      }
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'rate limited' }),
      });
    });

    await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('.router-login-mode-switch').click();
    const rateLimitAlert = page.locator('.router-identity-login-panel [role="alert"]');
    await expect(rateLimitAlert).toBeVisible({ timeout: 15_000 });
    await expect(rateLimitAlert).toContainText(/Too many requests|请求次数过多/);
    // Observe several poll intervals to catch any retry after the 429 response.
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(500);

    expect(statusPolls).toBe(2);
    await expect(page.getByRole('button', { name: /Refresh QR code|刷新二维码/ })).toBeVisible();
    await recorder.step(page, '通行证状态查询收到 429 后停止自动轮询');
  },
);
