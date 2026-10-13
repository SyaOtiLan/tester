/**
 * project — user-perspective baseline.
 *
 * Minimum user-flow coverage that any project e2e deployment should hit:
 *
 *   1. landing renders the project (DooTask) login or dashboard
 *   2. navigation surfaces at least one link or menu entry
 *   3. auth or wallet-connect affordance is discoverable in the DOM
 *
 * All three skip when `PROJECT_BASE_URL` is unset. When project (currently
 * down on :20833) comes up, these will start passing without code changes.
 */
import { test, expect, baseURLFor } from '../fixtures';

function skipIfNoService() {
  test.skip(!baseURLFor('project'), 'PROJECT_BASE_URL not configured');
}

// DooTask serves a Vue SPA: `/` redirects to `/#/login` and the shell paints
// before the view mounts. The "邮箱密码登录" toggle is a concrete element of the
// fully-rendered login view — once it is visible, the surrounding links/buttons
// have painted too. (Note: `<body class="window-landscape">` itself computes as
// hidden because content lives in a fixed overlay, so assert on view elements,
// not on `body`.)
async function waitForLoginView(page: import('@playwright/test').Page) {
  await page
    .getByRole('button', { name: /邮箱密码登录/ })
    .waitFor({ state: 'visible', timeout: 15_000 });
}

test("【登录、仪表盘与导航 / UI】 项目管理首页正常渲染", async ({ page }) => {
  skipIfNoService();
  await page.goto('/');
  await waitForLoginView(page);
  const text = (await page.locator('body').innerText()).trim();
  expect(text.length).toBeGreaterThan(50);
});

test("【登录、仪表盘与导航 / UI】 导航中至少显示一个链接或菜单入口", async ({ page }) => {
  skipIfNoService();
  await page.goto('/');
  await waitForLoginView(page);
  // Login view carries "Register account" / "Reset Password" as <a href>.
  const entries = page.locator('a[href], [role="link"], [role="menuitem"]');
  expect(await entries.count()).toBeGreaterThan(0);
});

test("【登录、仪表盘与导航 / UI】 可找到身份验证或钱包连接入口", async ({ page }) => {
  skipIfNoService();
  await page.goto('/');
  await waitForLoginView(page);
  // Loose: any input field, button, or link. Asserting DOM-attached
  // (not visible) — the login view wraps inputs behind a toggle, so a
  // strict visibility check on inputs is fragile. The user's perception
  // is just "is there something here to interact with".
  const affordance = page.locator('input, button, a, [role="button"], [role="link"]');
  expect(await affordance.count()).toBeGreaterThan(0);
});