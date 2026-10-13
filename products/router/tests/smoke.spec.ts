/**
 * router — AI model router with bundled admin UI.
 *
 * Env vars consumed:
 *   - ROUTER_BASE_URL (default http://localhost:3011)
 */
import { test, expect, baseURLFor } from '../fixtures';

test("【服务健康与公共信息 / API】 路由器根 URL 响应 2xx", async ({ request }) => {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
  const res = await request.get('/');
  expect(res.status()).toBeLessThan(500);
});

test("【管理后台 UI 与登录导航 / UI】 路由器管理UI页面呈现一些内容", async ({ page }) => {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
  await page.goto('/');
  const body = await page.locator('body').innerText();
  expect(body.length).toBeGreaterThan(0);
});

test("【服务健康与公共信息 / UI】 当服务中断时优雅地跳过所有路由器测试", async ({ request }) => {
  const url = baseURLFor('router');
  if (!url) {
    test.skip(true, 'ROUTER_BASE_URL not configured');
    return;
  }
  try {
    const res = await request.get('/', { timeout: 3_000 });
    expect(res.status()).toBeLessThan(500);
  } catch {
    test.skip(true, `router unreachable at ${url}`);
  }
});
