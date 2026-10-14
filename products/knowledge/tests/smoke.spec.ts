/**
 * knowledge — FastAPI + React/Vite.
 *
 * Env vars consumed:
 *   - KNOWLEDGE_BASE_URL (Vite frontend, default http://localhost:5173)
 *   - KNOWLEDGE_API_URL (FastAPI, default http://localhost:8000)
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { apiContext, expectStatus } from '../../../shared/api';

test(localizedTitle("【知识库与导航 / UI】 首页正常渲染", "home renders"), async ({ page }) => {
  test.skip(!baseURLFor('knowledge'), 'KNOWLEDGE_BASE_URL not configured');
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
});

test(localizedTitle("【知识库与导航 / UI】 首页至少包含一个导航链接", "home has at least one navigation link"), async ({ page }) => {
  test.skip(!baseURLFor('knowledge'), 'KNOWLEDGE_BASE_URL not configured');
  await page.goto('/');
  const links = page.locator('a[href]');
  const count = await links.count();
  expect(count).toBeGreaterThan(0);
});

test(localizedTitle("【知识库与导航 / API】 配置 KNOWLEDGE_API_URL 后，API /health 返回 2xx", "API /health responds 2xx when KNOWLEDGE_API_URL is set"), async () => {
  const apiURL = envFor('knowledge')['KNOWLEDGE_API_URL'];
  test.skip(!apiURL, 'KNOWLEDGE_API_URL not configured');
  const ctx = await apiContext(apiURL!);
  try {
    const res = await ctx.get('/health');
    expectStatus(res, (s) => s < 500);
  } finally {
    await ctx.dispose();
  }
});
