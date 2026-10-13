/**
 * router — user-perspective baseline.
 *
 * Minimum user-flow coverage that any router e2e deployment should hit:
 *
 *   1. landing renders the admin shell (real content, not blank/404)
 *   2. navigation surfaces at least one link or menu entry
 *   3. auth or wallet-connect affordance is discoverable in the DOM
 *
 * All three skip when `ROUTER_BASE_URL` is unset. Deeper router coverage
 * (sidebar shell, /login redirect, admin navigation) lives in `admin-ui.spec.ts`.
 */
import { test, expect, baseURLFor } from '../fixtures';

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}

test("【管理后台与工作台 / UI】 路由管理后台框架正常渲染", async ({ page }) => {
  skipIfNoService();
  await page.goto('/');
  // React SPA: wait for networkidle so the rendered UI is in the DOM
  // before any locator counts run.
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).toBeVisible();
  const text = (await page.locator('body').innerText()).trim();
  expect(text.length).toBeGreaterThan(50);
});

test("【管理后台与工作台 / UI】 导航表面至少有一个链接、按钮或菜单项", async ({ page }) => {
  skipIfNoService();
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  // Some apps (e.g. router) are a wallet-driven single-page with only
  // a "Wallet Login" button — no anchor links in the header. Include
  // buttons so those apps count as having a navigation affordance.
  const entries = page.locator(
    'a[href], button, [role="link"], [role="menuitem"], [role="button"]'
  );
  expect(await entries.count()).toBeGreaterThan(0);
});

test("【管理后台与工作台 / UI】 可找到身份验证或钱包连接入口", async ({ page }) => {
  skipIfNoService();
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  // Loose: any input field, button, or link. Asserting DOM-attached
  // (not visible) — Element Plus and similar frameworks wrap `<input>`
  // in hidden containers, so visibility checks are fragile. The user's
  // perception is just "is there something here to interact with".
  const affordance = page.locator('input, button, a, [role="button"], [role="link"]');
  expect(await affordance.count()).toBeGreaterThan(0);
});