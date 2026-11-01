/**
 * Orchestrator — runtime control plane + React frontend.
 *
 * Env vars consumed:
 *   - ORCHESTRATOR_BASE_URL (Vite frontend, default http://localhost:5174)
 *   - ORCHESTRATOR_API_URL (uvicorn backend, default http://localhost:3900)
 */
/* eslint-disable playwright/no-skipped-test -- Service availability depends on the local test environment. */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { apiContext, expectStatus } from '../../../shared/api';

test(
  localizedTitle('【登录页与钱包连接 UI / UI】 首页正常渲染', 'home renders'),
  async ({ page }) => {
    test.skip(!baseURLFor('orchestrator'), 'ORCHESTRATOR_BASE_URL not configured');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '登录运行控制台' })).toBeVisible();
  },
);

test(
  localizedTitle(
    '【登录页与钱包连接 UI / UI】 首页显示钱包连接入口',
    'home exposes wallet connect affordance',
  ),
  async ({ page }) => {
    test.skip(!baseURLFor('orchestrator'), 'ORCHESTRATOR_BASE_URL not configured');
    await page.goto('/');
    await expect(page.getByRole('button', { name: '使用钱包登录' })).toBeVisible();
  },
);

test(
  localizedTitle(
    '【健康检查与版本 / API】 配置 ORCHESTRATOR_API_URL 后，API health 返回 200',
    'API health responds 200 when ORCHESTRATOR_API_URL is set',
  ),
  async () => {
    const apiURL = envFor('orchestrator')['ORCHESTRATOR_API_URL'];
    test.skip(!apiURL, 'ORCHESTRATOR_API_URL not configured');
    const ctx = await apiContext(apiURL!);
    try {
      const res = await ctx.get('/api/v1/public/health');
      expectStatus(res, 200);
      expect(await res.json()).toEqual({ ok: true, service: 'orchestrator' });
    } finally {
      await ctx.dispose();
    }
  },
);
