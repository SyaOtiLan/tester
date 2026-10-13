/**
 * router — public info endpoints (no auth). RT-API-003 / RT-API-004.
 *
 * These read straight from backend config and are always reachable:
 *   - GET /billing/currencies  → { success, data: { default_currency, items[] } }
 *   - GET /about | /notice | /home_page_content → { success, data: <string> }
 *
 * NOTE (contract discrepancy vs docs): the case doc describes
 * /billing/currencies `data` as a currency *list*; the live service returns an
 * *object* with `default_currency` + an `items[]` array. Assertions reflect the
 * live shape.
 */
import { test, expect, baseURLFor } from '../fixtures';
import { apiContext } from '../../../shared/api';

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}

// RT-API-003 (P2)
test("【服务健康与公共信息 / API】 GET /billing/currencies 返回可用的计费货币", async () => {
  skipIfNoService();
  const ctx = await apiContext(baseURLFor('router')!);
  try {
    const res = await ctx.get('/api/v1/public/billing/currencies');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      success?: boolean;
      data?: { default_currency?: string; items?: Array<{ code?: string }> };
    };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data?.items)).toBe(true);
    // Each entry carries a currency code (e.g. CNY / USD).
    for (const item of body.data?.items ?? []) {
      expect(typeof item.code).toBe('string');
      expect((item.code ?? '').length).toBeGreaterThan(0);
    }
  } finally {
    await ctx.dispose();
  }
});

// RT-API-004 (P2)
test("【服务健康与公共信息 / API】 公共内容端点（/about, /notice, /home_page_content) 返回字符串", async () => {
  skipIfNoService();
  const ctx = await apiContext(baseURLFor('router')!);
  try {
    for (const path of ['/api/v1/public/about', '/api/v1/public/notice', '/api/v1/public/home_page_content']) {
      const res = await ctx.get(path);
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { success?: boolean; data?: unknown };
      expect(body.success).toBe(true);
      // Content may be empty (unset config item) but must be a string.
      expect(typeof body.data).toBe('string');
    }
  } finally {
    await ctx.dispose();
  }
});
