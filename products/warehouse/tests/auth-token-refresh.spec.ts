/**
 * warehouse — token validation & refresh (WH-API-008, WH-API-009).
 *
 *   - WH-API-008: a forged / malformed Bearer token on a protected endpoint
 *     (/webdav/user/info) is rejected with 401.
 *   - WH-API-009: password login sets a `refresh_token` cookie; POST
 *     /api/v1/public/auth/refresh with that cookie mints a fresh access token.
 *
 * Requires:
 *   - WAREHOUSE_WEBDAV_URL (backend API origin, e.g. http://localhost:6065)
 *   - WAREHOUSE_USER + WAREHOUSE_PASS (for the refresh round-trip)
 *
 * Source: middleware/auth.go rejects invalid JWTs with 401; web3.go
 * HandlePasswordLogin sets the refresh_token cookie and HandleRefresh returns
 * {data:{token, expiresAt, ...}}.
 */
import { test, expect, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';

function apiBase(): string | undefined {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_URL'];
}
function hasPassword(): boolean {
  const env = envFor('warehouse');
  return Boolean(env['WAREHOUSE_USER'] && env['WAREHOUSE_PASS']);
}

test("【鉴权与会话 / API】 WH-API-008 受保护接口非法/过期 JWT 返回 401", async () => {
  test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');

  // A structurally-plausible but unsigned/garbage JWT.
  const bogus =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmYWtlIiwiZXhwIjoxfQ.not-a-real-signature';

  for (const token of [bogus, 'totally-not-a-jwt']) {
    const ctx = await apiContext(apiBase()!, { Authorization: `Bearer ${token}` });
    try {
      const res = await ctx.get('/api/v1/public/webdav/user/info');
      expect(res.status(), `token=${token}`).toBe(401);
    } finally {
      await ctx.dispose();
    }
  }
});

test("【鉴权与会话 / API】 WH-API-009 auth/refresh 刷新令牌", async () => {
  test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
  test.skip(!hasPassword(), 'WAREHOUSE_USER/PASS required for refresh round-trip');

  const env = envFor('warehouse');
  // A single context so the Set-Cookie from login is replayed on refresh.
  const ctx = await apiContext(apiBase()!);
  try {
    const login = await ctx.post('/api/v1/public/auth/password/login', {
      data: { username: env['WAREHOUSE_USER'], password: env['WAREHOUSE_PASS'] },
    });
    expect(login.status()).toBe(200);
    const loginToken = (await login.json()).data.token as string;
    expect(loginToken).toBeTruthy();

    const refresh = await ctx.post('/api/v1/public/auth/refresh');
    expect(refresh.status()).toBe(200);
    const body = (await refresh.json()) as { data: { token: string; expiresAt: number } };
    expect(body.data.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(body.data.expiresAt).toBeGreaterThan(Date.now());

    // The refreshed token must actually authenticate a protected endpoint.
    const authed = await apiContext(apiBase()!, {
      Authorization: `Bearer ${body.data.token}`,
    });
    try {
      const info = await authed.get('/api/v1/public/webdav/user/info');
      expect(info.status()).toBe(200);
    } finally {
      await authed.dispose();
    }
  } finally {
    await ctx.dispose();
  }
});
