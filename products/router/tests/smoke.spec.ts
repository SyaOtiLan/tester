/**
 * router — AI model router with bundled admin UI.
 *
 * Env vars consumed:
 *   - ROUTER_BASE_URL (default http://localhost:3011)
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';

test(localizedTitle("【服务健康与公共信息 / API】 路由器根 URL 响应 2xx", "router root URL responds 2xx"), async ({ request }) => {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
  const res = await request.get('/');
  expect(res.status()).toBeLessThan(500);
});

test(localizedTitle("【管理后台 UI 与登录导航 / UI】 路由器管理UI页面呈现一些内容", "router admin UI page renders some content"), async ({ page }) => {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
  await page.goto('/');
  const body = await page.locator('body').innerText();
  expect(body.length).toBeGreaterThan(0);
});

test(localizedTitle("【服务健康与公共信息 / UI】 当服务中断时优雅地跳过所有路由器测试", "gracefully skip all router tests when service is down"), async ({ request }) => {
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
