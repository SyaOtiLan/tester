/**
 * social — deeper user-flow: SPA login.
 *
 * Track 2 of the user-perspective baseline. Social is a Vue 2 SPA with
 * hash-based routing (`createWebHashHistory`); `/` redirects to `/login`,
 * and the login view (`web/src/view/Login.vue`) exposes two real auth
 * paths:
 *
 *   - `.wallet-login-button` — wallet sign-in (covered in
 *     products/wallet/tests/ if/when a dapp-social spec is added; out of
 *     scope here)
 *   - QR-code identity mode — toggled via the corner ribbon
 *     `.login-mode-switch-box`, which kicks off
 *     `createIdentityLoginSession()` and renders a QR. A small
 *     `.login-passport-local` link then offers "无法扫码？使用本机通行证登录"
 *     which opens the passport `verifyUrl` in a new tab — there's no
 *     local credential form on this page.
 *
 * Selectors come from social/web/src/view/Login.vue (form structure).
 *
 * Note: uses `SOCIAL_WEB_URL` (the SPA at :8082), NOT `SOCIAL_BASE_URL`
 * (the Spring Boot backend at :8888).
 */
import { test, expect, envFor } from '../fixtures';

const spaURL = () => envFor('social')['SOCIAL_WEB_URL']!;

function skipIfNoSPA() {
  test.skip(!envFor('social')['SOCIAL_WEB_URL'], 'SOCIAL_WEB_URL not configured');
}

test("【登录与服务探活 / UI】 root 通过哈希路由重定向到 /login", async ({ page }) => {
  skipIfNoSPA();
  await page.goto(spaURL());
  await expect(page).toHaveURL(/#\/login$/);
});

test("【登录与服务探活 / UI】 登录表单默认显示钱包按钮", async ({ page }) => {
  skipIfNoSPA();
  await page.goto(`${spaURL()}/#/login`);
  // Default mode is wallet — that's the primary entry point.
  await expect(page.locator('.wallet-login-button')).toBeVisible({ timeout: 10_000 });
});

test("【登录与服务探活 / UI】 切换到身份模式会呈现 QR + 护照本地链接", async ({ page }) => {
  skipIfNoSPA();
  await page.goto(`${spaURL()}/#/login`);
  // The corner ribbon toggles between wallet and identity modes.
  await page.locator('.login-mode-switch-box').click();
  // After toggling, the QR frame and the "scan-failed" fallback link
  // both appear. We assert both are visible — that's the real UX shape.
  await expect(page.locator('.login-qrcode-frame')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.login-passport-local')).toBeVisible({ timeout: 10_000 });
});

test("【登录与服务探活 / UI】 身份模式触发护照会话（QR 或加载状态）", async ({ page }) => {
  skipIfNoSPA();
  await page.goto(`${spaURL()}/#/login`);
  await page.locator('.login-mode-switch-box').click();
  // After switching, the SPA fires `createIdentityLoginSession()`.
  // The QR frame is shown immediately; either the rendered `<img>` or
  // the "二维码生成中..." loading placeholder is visible within a few
  // seconds (whichever renders first is fine — what matters is that
  // the API round-trip was attempted).
  await expect(page.locator('.login-qrcode-frame')).toBeVisible({ timeout: 10_000 });
  await expect(
    page.locator('.login-qrcode-image, .login-qrcode-loading')
  ).toBeVisible({ timeout: 15_000 });
});

// SO-UI-008 (P2) — clicking wallet login with no injected provider surfaces a
// clean error and does not crash the page.
test("【SPA 登录界面(钱包 / 通行证) / UI】 SO-UI-008 点击钱包登录驱动 web3 provider 流程并优雅报错", async ({ page }) => {
  skipIfNoSPA();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(`${spaURL()}/#/login`);
  const walletBtn = page.locator('.wallet-login-button');
  await expect(walletBtn).toBeVisible({ timeout: 10_000 });
  await walletBtn.click();

  // No wallet extension -> the SPA shows an Element-Plus message ("未检测到钱包插件").
  const msg = page.locator('.el-message');
  await expect(msg).toBeVisible({ timeout: 10_000 });
  await expect(msg).toContainText('钱包');

  // No JS crash: still on the login page, the button remains usable.
  await expect(page).toHaveURL(/#\/login$/);
  await expect(walletBtn).toBeVisible();
  expect(pageErrors).toEqual([]);
});

// SO-UI-009 (P2) — the register page (#/register) renders its full form.
test("【SPA 登录界面(钱包 / 通行证) / UI】 SO-UI-009 注册页表单渲染", async ({ page }) => {
  skipIfNoSPA();
  await page.goto(`${spaURL()}/#/register`);
  await expect(page).toHaveURL(/#\/register$/);

  // Email / nickname / password / confirm-password fields.
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByPlaceholder('昵称')).toBeVisible();
  await expect(page.getByPlaceholder('密码', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('确认密码', { exact: true })).toBeVisible();

  // Register / clear actions + the "already have an account" link back to login.
  await expect(page.getByRole('button', { name: '注册' })).toBeVisible();
  await expect(page.getByRole('button', { name: '清空' })).toBeVisible();
  await expect(page.locator('.to-login')).toContainText('前往登录');
});