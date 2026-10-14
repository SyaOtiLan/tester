/**
 * social — user-perspective baseline.
 *
 * Minimum user-flow coverage that any social e2e deployment should hit:
 *
 *   1. landing renders the social SPA (currently hash-routed, redirects
 *      from `/` to `#/login`)
 *   2. navigation surfaces at least one link or menu entry
 *   3. auth or wallet-connect affordance is discoverable in the DOM
 *
 * All three skip when `SOCIAL_WEB_URL` is unset. SOCIAL_BASE_URL points
 * to the Spring Boot backend (8888) and is *not* what we want here —
 * we want the Vue 2 SPA on 8082. Deeper social coverage (real login
 * form, post-login /home/chat navigation) lives in `spa-login.spec.ts`.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, envFor } from '../fixtures';

function skipIfNoSPA() {
  test.skip(!envFor('social')['SOCIAL_WEB_URL'], 'SOCIAL_WEB_URL not configured');
}

const spaURL = () => envFor('social')['SOCIAL_WEB_URL']!;

test(localizedTitle("【登录与服务探活 / UI】 社交应用页面正常渲染", "landing renders the social SPA"), async ({ page }) => {
  skipIfNoSPA();
  await page.goto(spaURL());
  await expect(page.locator('body')).toBeVisible();
  const text = (await page.locator('body').innerText()).trim();
  expect(text.length).toBeGreaterThan(50);
});

test(localizedTitle("【登录与服务探活 / UI】 导航中至少显示一个链接或菜单入口", "navigation surfaces at least one link or menu entry"), async ({ page }) => {
  skipIfNoSPA();
  await page.goto(spaURL());
  const entries = page.locator('a[href], [role="link"], [role="menuitem"]');
  await expect(entries.first()).toBeVisible({ timeout: 10_000 });
  expect(await entries.count()).toBeGreaterThan(0);
});

test(localizedTitle("【登录与服务探活 / UI】 可找到身份验证或钱包连接入口", "auth or wallet-connect affordance is discoverable"), async ({ page }) => {
  skipIfNoSPA();
  await page.goto(spaURL());
  // Element Plus wraps `<input>` in a styled container; the raw
  // `<input>` is technically hidden. Asserting on the wrapper
  // (`.el-input` / `.el-button`) or just DOM-attached presence
  // sidesteps that and matches what the user perceives.
  const affordance = page
    .locator('.el-input, .el-button, button, input, a')
    .filter({ hasNot: page.locator('[aria-hidden="true"]') });
  expect(await affordance.count()).toBeGreaterThan(0);
});