/**
 * warehouse — quota enforcement (WH-API-060).
 *
 * A WebDAV PUT whose body would push the user past their quota is rejected with
 * 507 Insufficient Storage. The default per-user quota is 1 GiB, which is not
 * practical to fill in a test, so we provision a throwaway user with a tiny
 * quota via the admin API and then, authenticated AS that user, PUT a body
 * larger than the quota.
 *
 * Because provisioning requires the admin API (AdminMiddleware / AdminAddresses),
 * this case is gated on capabilities.manageUsers and skips cleanly when the
 * configured identity is not an admin — filling the real 1 GiB default quota is
 * not a viable alternative in a test.
 *
 * Requires:
 *   - WAREHOUSE_WEBDAV_URL and one working credential for acquireToken()
 *   - the credential's wallet address in Security.AdminAddresses (else skip)
 *
 * Source: webdav_service.go checkQuota → quotaService.CheckQuota → on excess the
 * handler responds 507 "Insufficient Storage"; MKCOL is exempt (0 additional
 * size), PUT/POST use the request body size.
 */
import { test, expect, envFor } from '../fixtures';
import { acquireToken, authedRequest, getUserInfo } from '../helpers/auth';
import { apiContext } from '../../../shared/api';

function apiBase(): string | undefined {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_URL'];
}
function prefix(): string {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_PREFIX'] ?? '/dav';
}
function hasCredential(): boolean {
  const env = envFor('warehouse');
  return Boolean(
    env['WAREHOUSE_AUTH_TOKEN'] ||
      (env['WAREHOUSE_USER'] && env['WAREHOUSE_PASS']) ||
      env['WAREHOUSE_WALLET_PRIVATE_KEY'],
  );
}

test.describe("【配额】配额执行（quota enforcement）", () => {
  let adminToken = '';
  let canManage = false;

  test.beforeAll(async () => {
    if (!apiBase() || !hasCredential()) return;
    adminToken = (await acquireToken(apiBase()!)).token;
    const info = await getUserInfo(apiBase()!, adminToken);
    canManage = info.capabilities.manageUsers;
  });

  test("【配额 / API】 WH-API-060 超配额上传被拒", async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!hasCredential(), 'no warehouse credential configured');
    test.skip(
      !canManage,
      'cannot provision a small-quota user: configured identity is not an admin (wallet not in Security.AdminAddresses), and filling the 1 GiB default quota is impractical',
    );

    const username = `e2e-quota-${Date.now()}`;
    const password = 'quota-passw0rd';
    const quotaBytes = 1024; // 1 KiB
    const admin = await authedRequest(apiBase()!, adminToken);
    try {
      const create = await admin.post('/api/v1/admin/users/create', {
        data: { username, password, quota: quotaBytes },
      });
      expect(create.status()).toBe(201);

      // Authenticate as the throwaway user.
      const anon = await apiContext(apiBase()!);
      let userToken = '';
      try {
        const login = await anon.post('/api/v1/public/auth/password/login', {
          data: { username, password },
        });
        expect(login.status()).toBe(200);
        userToken = ((await login.json()) as { data: { token: string } }).data.token;
      } finally {
        await anon.dispose();
      }

      // PUT a body larger than the quota → 507 Insufficient Storage.
      const userCtx = await authedRequest(apiBase()!, userToken);
      try {
        const big = 'x'.repeat(quotaBytes * 5);
        const put = await userCtx.fetch(`${prefix()}/e2e-quota-overflow-${Date.now()}.txt`, {
          method: 'PUT',
          data: big,
        });
        expect(put.status()).toBe(507);
      } finally {
        await userCtx.dispose();
      }
    } finally {
      await admin
        .post('/api/v1/admin/users/delete', { data: { username } })
        .catch(() => undefined);
      await admin.dispose();
    }
  });
});
