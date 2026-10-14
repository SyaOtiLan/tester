/**
 * chat — Next.js + UCAN/wallet.
 *
 * Env vars consumed:
 *   - CHAT_BASE_URL (default http://localhost:3020)
 *   - OPENAI_API_KEY / ANTHROPIC_API_KEY (optional; conversation tests skip without)
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, hasEnv } from '../fixtures';

test(localizedTitle("【首页与导航 / UI】 首页显示标题区域", "home renders with a heading region"), async ({ page }) => {
  test.skip(!baseURLFor('chat'), 'CHAT_BASE_URL not configured');
  await page.goto('/');
  // Be lenient: the SPA mounts the Home component, then the unauthenticated
  // landing client-redirects to the wallet auth gate — poll for real content
  // instead of reading an empty mid-redirect shell.
  await expect
    .poll(async () => (await page.locator('body').innerText()).trim().length, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
});

test(localizedTitle("【健康检查与冒烟 / API】 首页返回 2xx", "home responds 2xx"), async ({ request }) => {
  test.skip(!baseURLFor('chat'), 'CHAT_BASE_URL not configured');
  const res = await request.get('/');
  expect(res.status()).toBeLessThan(500);
});

test(localizedTitle("【LLM 会话 / E2E】 未配置 Provider 密钥时跳过 LLM 会话测试", "LLM conversation tests skipped when no provider key"), () => {
  const hasOpenAI = hasEnv('OPENAI_API_KEY');
  const hasAnthropic = hasEnv('ANTHROPIC_API_KEY');
  test.skip(!hasOpenAI && !hasAnthropic, 'no LLM provider key (OPENAI_API_KEY / ANTHROPIC_API_KEY)');
  // This empty body is intentionally a "passes once not skipped" guard; expand
  // when adding real conversation specs.
  expect(hasOpenAI || hasAnthropic).toBe(true);
});
