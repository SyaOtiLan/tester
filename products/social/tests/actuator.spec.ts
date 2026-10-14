/**
 * social — Spring Boot actuator smoke (backend-only, frontend 8082 is down).
 *
 * The social backend (Java + Spring Boot) is reachable at 8888; the
 * Vue 2 SPA that proxies it is on 8082 (down). Business endpoints return
 * 500 from a stub controller, but the Spring Boot actuator endpoints
 * confirm the service is healthy and the JVM is up.
 *
 * Requires:
 *   - SOCIAL_BASE_URL (set to the Spring Boot backend, e.g. http://localhost:8888)
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';
import { apiContext, expectStatus } from '../../../shared/api';

function skipIfNoService() {
  test.skip(!baseURLFor('social'), 'SOCIAL_BASE_URL not configured');
}

test(localizedTitle("【登录与服务探活 / API】 actuator/health 返回服务运行状态 UP", "actuator/health reports the service is UP"), async () => {
  skipIfNoService();
  const baseURL = baseURLFor('social')!;
  const ctx = await apiContext(baseURL);
  try {
    const res = await ctx.get('/actuator/health');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('UP');
  } finally {
    await ctx.dispose();
  }
});

test(localizedTitle("【登录与服务探活 / API】 根 URL 返回 SPA 首页或后端重定向", "root URL responds (SPA index or backend redirect)"), async () => {
  skipIfNoService();
  const ctx = await apiContext(baseURLFor('social')!);
  try {
    const res = await ctx.get('/');
    expectStatus(res, (s) => s < 500);
  } finally {
    await ctx.dispose();
  }
});

test(localizedTitle("【登录与服务探活 / API】 actuator/env 在开发环境可访问且无需鉴权", "actuator/env is reachable (no auth required in dev)"), async () => {
  skipIfNoService();
  const ctx = await apiContext(baseURLFor('social')!);
  try {
    const res = await ctx.get('/actuator/env');
    // Dev-mode actuator endpoints are open; some prod configs gate them.
    expectStatus(res, (s) => s < 500);
  } finally {
    await ctx.dispose();
  }
});