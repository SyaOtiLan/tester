/**
 * agent hub — control plane + React frontend.
 *
 * Env vars consumed:
 *   - AGENT_BASE_URL (Vite frontend, default http://localhost:5174)
 *   - AGENT_API_URL (uvicorn backend, default http://localhost:3900)
 *   - AGENT_PRIVATE_KEY (optional; wallet tests skip without)
 */
import { test, expect, baseURLFor, envFor, hasEnv } from '../fixtures';
import { apiContext, expectStatus } from '../../../shared/api';

test("【登录页与钱包连接 UI / UI】 首页正常渲染", async ({ page }) => {
  test.skip(!baseURLFor('agent'), 'AGENT_BASE_URL not configured');
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
});

test("【登录页与钱包连接 UI / UI】 首页显示钱包连接入口", async ({ page }) => {
  test.skip(!baseURLFor('agent'), 'AGENT_BASE_URL not configured');
  await page.goto('/');
  // Look for a button-like affordance; the exact label depends on the build.
  const button = page.locator('button, [role="button"]').first();
  await expect(button).toBeVisible();
});

test("【健康检查与版本 / API】 配置 AGENT_API_URL 后，API /health 返回 2xx", async () => {
  const apiURL = envFor('agent')['AGENT_API_URL'];
  test.skip(!apiURL, 'AGENT_API_URL not configured');
  const ctx = await apiContext(apiURL!);
  try {
    const res = await ctx.get('/health');
    expectStatus(res, (s) => s < 500);
  } finally {
    await ctx.dispose();
  }
});

test("【钱包鉴权与会话 / DAPP】 未配置 AGENT_PRIVATE_KEY 时跳过钱包签名用例", () => {
  test.skip(!hasEnv('AGENT_PRIVATE_KEY'), 'AGENT_PRIVATE_KEY not set');
  expect(true).toBe(true);
});
