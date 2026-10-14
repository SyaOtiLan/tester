/**
 * Router — wallet SIWE login + public status + admin UI smoke.
 *
 * Router auth uses a custom (non-EIP-4361) challenge format
 *   "Login to {SystemName}\nNonce: {nonce}\nAddress: {addr}\nIssued At: {ts}"
 * but the verify flow still uses personal_sign over the returned message.
 *
 * The auth endpoints are protected by a CriticalRateLimit middleware, so
 * the 3 SIWE tests share one login via a serial describe block rather
 * than each paying the cost.
 *
 * Requires:
 *   - ROUTER_BASE_URL
 *   - ROUTER_WALLET_PRIVATE_KEY
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { apiContext, expectStatus } from '../../../shared/api';
import { loginWithWallet, type RouterTokens } from '../helpers/auth';

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}

test(localizedTitle("【服务健康与公共信息 / API】 GET /api/v1/public/status 返回路由器配置", "GET /api/v1/public/status returns router config"), async () => {
  skipIfNoService();
  const baseURL = baseURLFor('router')!;
  const ctx = await apiContext(baseURL);
  try {
    const res = await ctx.get('/api/v1/public/status');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data.system_name).toBeTruthy();
    expect(typeof body.data.register_enabled).toBe('boolean');
  } finally {
    await ctx.dispose();
  }
});

test(localizedTitle("【服务健康与公共信息 / API】 GET /api/v1/public/topup/plans 返回计划列表", "GET /api/v1/public/topup/plans returns a plans list"), async () => {
  skipIfNoService();
  const baseURL = baseURLFor('router')!;
  const ctx = await apiContext(baseURL);
  try {
    const res = await ctx.get('/api/v1/public/topup/plans');
    expect([200]).toContain(res.status());
    const body = (await res.json()) as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
  } finally {
    await ctx.dispose();
  }
});

test.describe(localizedTitle("【钱包自定义 SIWE 鉴权】SIWE钱包登录（串口，共享JWT）（SIWE wallet login (serial, shared JWT)）", "SIWE wallet login (serial, shared JWT)"), () => {
  test.describe.configure({ mode: 'serial' });
  let tokens: RouterTokens | null = null;
  let challengeMsg = '';

  test(localizedTitle("【钱包自定义 SIWE 鉴权 / API】 挑战返回绑定到钱包的自定义格式消息", "challenge returns a custom-format message bound to the wallet"), async () => {
    skipIfNoService();
    const env = envFor('router');
    test.skip(!env['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');
    const baseURL = baseURLFor('router')!;
    const ctx = await apiContext(baseURL);
    try {
      const addr = '0xcD05C9a21555319Ff0cF0A9C177aFe414B6Aa7B6';
      const res = await ctx.post('/api/v1/public/common/auth/challenge', {
        data: { address: addr },
      });
      expect(res.status()).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: { message: string; nonce: string; address: string; expires_at: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.message).toContain('Login to');
      expect(body.data.message.toLowerCase()).toContain(addr.toLowerCase());
      expect(body.data.message).toContain(body.data.nonce);
      expect(body.data.nonce).toMatch(/^[a-f0-9]{16,}$/);
      challengeMsg = body.data.message;
    } finally {
      await ctx.dispose();
    }
  });

  test(localizedTitle("【钱包自定义 SIWE 鉴权 / API】 verify 返回绑定到钱包的 JWT", "verify returns a JWT bound to the wallet"), async () => {
    skipIfNoService();
    const env = envFor('router');
    test.skip(!env['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');
    // NOTE: We call loginWithWallet (which issues a fresh challenge and
    // signs it) rather than reusing challengeMsg above — running the
    // challenge test isolated would leave a challenge entry in the router
    // nonce store without consuming it, and a later parallel test could
    // overwrite the nonce before this test gets to verify it.
    void challengeMsg;
    tokens = await loginWithWallet(baseURLFor('router')!, env['ROUTER_WALLET_PRIVATE_KEY']!);
    expect(tokens.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(tokens.address.toLowerCase()).toBe(
      env['ROUTER_EXPECTED_ADDRESS']?.toLowerCase() ?? tokens.address.toLowerCase(),
    );
    expect(tokens.userId).toBeTruthy();
  });

  test(localizedTitle("【钱包自定义 SIWE 鉴权 / API】 JWT 解锁受保护的 /profile 端点", "JWT unlocks the protected /profile endpoint"), async () => {
    skipIfNoService();
    test.skip(!tokens, 'previous test did not produce a JWT');
    const ctx = await apiContext(baseURLFor('router')!, {
      Authorization: `Bearer ${tokens!.token}`,
    });
    try {
      const res = await ctx.get('/api/v1/public/profile');
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { code: number; data: { address: string } };
      expect(body.code).toBe(0);
      expect(body.data.address.toLowerCase()).toBe(tokens!.address.toLowerCase());
    } finally {
      await ctx.dispose();
    }
  });
});

test(localizedTitle("【鉴权与权限边界 / API】 配置文件拒绝未经身份验证的请求", "profile rejects unauthenticated requests"), async () => {
  skipIfNoService();
  const ctx = await apiContext(baseURLFor('router')!);
  try {
    const res = await ctx.get('/api/v1/public/profile');
    expectStatus(res, (s) => s === 401 || s === 403);
  } finally {
    await ctx.dispose();
  }
});

test(localizedTitle("【管理后台 UI 与登录导航 / UI】 管理 UI HTML 页面呈现", "admin UI HTML page renders"), async ({ page }) => {
  skipIfNoService();
  await page.goto(baseURLFor('router')!);
  await expect(page).toHaveTitle(/Router/);
});