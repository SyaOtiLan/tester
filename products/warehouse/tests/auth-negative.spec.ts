/**
 * warehouse — negative auth boundaries (WH-API-006, WH-API-007, WH-API-022).
 *
 * All three exercise the backend directly on the WebDAV/API port (6065):
 *   - WH-API-006 password login with a wrong password → 401 (no token issued)
 *   - WH-API-007 protected JSON API without JWT       → 401
 *   - WH-API-022 WebDAV PROPFIND without credentials  → 401 + WWW-Authenticate
 *
 * Requires:
 *   - WAREHOUSE_WEBDAV_URL     (backend API+WebDAV origin, e.g. http://localhost:6065)
 *   - WAREHOUSE_USER           (existing account username, for the 006 wrong-password case)
 *
 * Optional:
 *   - WAREHOUSE_WEBDAV_PREFIX  (defaults to /dav)
 *
 * Verified source behavior:
 *   - web3.go password login → 401 {message:"Invalid username or password"}
 *   - middleware/auth.go: missing creds on a required route → 401 "Authentication required";
 *     for WebDAV methods it also sets WWW-Authenticate: Basic realm="WebDAV".
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';

function apiBase(): string | undefined {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_URL'];
}

test.describe(localizedTitle("【鉴权与会话】仓库负授权（warehouse negative auth）", "warehouse negative auth"), () => {
  test(localizedTitle("【鉴权与会话 / API】 WH-API-006 密码登录错误口令被拒", "WH-API-006 password login with a wrong password is rejected (401, no token)"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    const username = envFor('warehouse')['WAREHOUSE_USER'];
    test.skip(!username, 'WAREHOUSE_USER not configured');
    const ctx = await apiContext(apiBase()!);
    try {
      const res = await ctx.post('/api/v1/public/auth/password/login', {
        data: { username, password: `definitely-wrong-${Date.now()}` },
      });
      expect(res.status()).toBe(401);
      const body = (await res.json()) as { data?: unknown; message?: string };
      // No token must be issued on failure.
      expect(body.data ?? null).toBeNull();
    } finally {
      await ctx.dispose();
    }
  });

  test(localizedTitle("【鉴权与会话 / API】 WH-API-007 受保护接口缺少 JWT 返回 401", "WH-API-007 protected API without JWT returns 401"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    const ctx = await apiContext(apiBase()!);
    try {
      const res = await ctx.get('/api/v1/public/webdav/quota');
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test(localizedTitle("【WebDAV 文件访问协议 / API】 WH-API-022 无凭证访问 WebDAV 返回 401", "WH-API-022 WebDAV PROPFIND without credentials returns 401 + WWW-Authenticate"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    const prefix = envFor('warehouse')['WAREHOUSE_WEBDAV_PREFIX'] ?? '/dav';
    const ctx = await apiContext(apiBase()!);
    try {
      const res = await ctx.fetch(`${prefix}/`, {
        method: 'PROPFIND',
        headers: { Depth: '1' },
      });
      expect(res.status()).toBe(401);
      const headers = res.headers();
      expect(headers['www-authenticate'], 'must challenge with WWW-Authenticate').toBeTruthy();
    } finally {
      await ctx.dispose();
    }
  });
});
