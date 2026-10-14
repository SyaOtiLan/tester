/**
 * warehouse — admin authorization boundary (WH-API-075).
 *
 * A JWT whose wallet address is NOT in the server's AdminAddresses allowlist
 * must be rejected by the admin middleware with 403 Forbidden.
 *
 * Requires:
 *   - WAREHOUSE_WEBDAV_URL  (backend API origin, e.g. http://localhost:6065)
 *   - one working credential for acquireToken():
 *       WAREHOUSE_USER + WAREHOUSE_PASS, or WAREHOUSE_AUTH_TOKEN,
 *       or WAREHOUSE_WALLET_PRIVATE_KEY
 *
 * Product note: the default "admin" login account is an *application* admin
 * (can manage its own files) but its wallet address is not in the backend's
 * AdminAddresses allowlist, so it is a valid "non-admin" subject for this
 * platform-admin endpoint. Source: middleware/admin.go returns 403 "Forbidden"
 * when the caller's wallet is not allow-listed.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, envFor } from '../fixtures';
import { acquireToken, authedRequest } from '../helpers/auth';

function apiBase(): string | undefined {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_URL'];
}

function hasCredential(): boolean {
  const env = envFor('warehouse');
  return Boolean(
    env['WAREHOUSE_AUTH_TOKEN'] ||
      (env['WAREHOUSE_USER'] && env['WAREHOUSE_PASS']) ||
      env['WAREHOUSE_WALLET_PRIVATE_KEY'],
  );
}

test(localizedTitle("【管理员用户管理 / API】 WH-API-075 非管理员访问 admin 接口返回 403", "WH-API-075 non-admin JWT is forbidden on admin users/list (403)"), async () => {
  test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
  test.skip(!hasCredential(), 'no warehouse credential configured');

  const tokens = await acquireToken(apiBase()!);
  const ctx = await authedRequest(apiBase()!, tokens.token);
  try {
    const res = await ctx.get('/api/v1/admin/users/list');
    expect(res.status()).toBe(403);
  } finally {
    await ctx.dispose();
  }
});
