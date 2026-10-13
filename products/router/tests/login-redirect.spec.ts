/**
 * router — unauthenticated workspace access is redirected to /login (RT-UI-007).
 *
 * `PrivateRoute` gates every `/workspace/*` route on `localStorage['user']`.
 * With no seeded session, hitting `/workspace/token` client-side redirects to
 * `/login?redirect=<encoded original path>` (see helpers/authRedirect.js
 * `buildLoginPath`) and mounts the login shell `.router-login-page`.
 *
 * No session is seeded here — a fresh Playwright context starts with empty
 * localStorage, which is exactly the unauthenticated precondition.
 */
import { test, expect, baseURLFor } from '../fixtures';

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}

// RT-UI-007 (P0)
test("【管理后台与工作台 / UI】 未经身份验证的 /workspace/* 被重定向到 /login?redirect=", async ({ page, baseURL, recorder }) => {
  skipIfNoService();

  await page.goto(`${baseURL}/workspace/token`, { waitUntil: 'domcontentloaded' });

  // Client-side PrivateRoute redirect → URL carries the encoded original path.
  await expect(page).toHaveURL(/\/login\?redirect=%2Fworkspace%2Ftoken/, { timeout: 15_000 });

  // The login page shell mounts.
  await expect(page.locator('.router-login-page')).toBeVisible({ timeout: 15_000 });
  await recorder.step(page, '未登录访问工作台被重定向到登录页');
});
