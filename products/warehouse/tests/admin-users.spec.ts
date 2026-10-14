/**
 * warehouse — admin user management (WH-API-071, 072, 073).
 *
 *   - WH-API-071: GET  /api/v1/admin/users/list          → 200 { items:[...] }
 *   - WH-API-072: POST /api/v1/admin/users/create        → 201 (throwaway user)
 *   - WH-API-073: POST /api/v1/admin/users/reset-password → 200 { success:true }
 *
 * These endpoints sit behind AdminMiddleware, which only admits callers whose
 * wallet address is listed in Security.AdminAddresses. We gate on the
 * authoritative signal — capabilities.manageUsers from /webdav/user/info — so
 * the cases run for real when the configured identity is an admin and skip
 * cleanly (never fake) when it is not.
 *
 * Requires:
 *   - WAREHOUSE_WEBDAV_URL and one working credential for acquireToken()
 *   - the credential's wallet address to be in Security.AdminAddresses (else skip)
 *
 * Source: router.go admin routes; handler/admin_user.go HandleList {items},
 * HandleCreate (201 adminUserResponse), HandleResetPassword (200 {success}),
 * HandleDelete {username} (used for cleanup).
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, envFor } from '../fixtures';
import { acquireToken, authedRequest, getUserInfo } from '../helpers/auth';
import { apiContext } from '../../../shared/api';

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

test.describe(localizedTitle("【管理员用户管理】管理员用户管理（admin user management）", "admin user management"), () => {
  test.describe.configure({ mode: 'serial' });
  let adminToken = '';
  let canManage = false;

  test.beforeAll(async () => {
    if (!apiBase() || !hasCredential()) return;
    adminToken = (await acquireToken(apiBase()!)).token;
    const info = await getUserInfo(apiBase()!, adminToken);
    canManage = info.capabilities.manageUsers;
  });

  function gate() {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!hasCredential(), 'no warehouse credential configured');
    test.skip(
      !canManage,
      'configured warehouse identity is not an admin (wallet not in Security.AdminAddresses); admin endpoints are 403 for it',
    );
  }

  test(localizedTitle("【管理员用户管理 / API】 WH-API-071 管理员列出用户", "WH-API-071 an admin can list all users"), async () => {
    gate();
    const ctx = await authedRequest(apiBase()!, adminToken);
    try {
      const res = await ctx.get('/api/v1/admin/users/list');
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { items: Array<{ id: string; username: string }> };
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.length).toBeGreaterThanOrEqual(1);
    } finally {
      await ctx.dispose();
    }
  });

  test(localizedTitle("【管理员用户管理 / API】 WH-API-072 管理员创建用户", "WH-API-072 an admin can create a user"), async () => {
    gate();
    const username = `e2e-admin-create-${Date.now()}`;
    const ctx = await authedRequest(apiBase()!, adminToken);
    try {
      const res = await ctx.post('/api/v1/admin/users/create', {
        data: { username, password: 'e2e-passw0rd', quota: 1073741824 },
      });
      expect(res.status()).toBe(201);
      const body = (await res.json()) as { username: string };
      expect(body.username).toBe(username);
    } finally {
      // cleanup
      await ctx
        .post('/api/v1/admin/users/delete', { data: { username } })
        .catch(() => undefined);
      await ctx.dispose();
    }
  });

  test(localizedTitle("【管理员用户管理 / API】 WH-API-073 管理员重置用户密码", "WH-API-073 an admin can reset a user password"), async () => {
    gate();
    const username = `e2e-admin-reset-${Date.now()}`;
    const ctx = await authedRequest(apiBase()!, adminToken);
    try {
      // provision a throwaway user
      const create = await ctx.post('/api/v1/admin/users/create', {
        data: { username, password: 'initial-passw0rd' },
      });
      expect(create.status()).toBe(201);

      // reset its password
      const reset = await ctx.post('/api/v1/admin/users/reset-password', {
        data: { username, password: 'reset-passw0rd' },
      });
      expect(reset.status()).toBe(200);
      const body = (await reset.json()) as { success: boolean };
      expect(body.success).toBe(true);

      // the new password authenticates
      const anon = await apiContext(apiBase()!);
      try {
        const login = await anon.post('/api/v1/public/auth/password/login', {
          data: { username, password: 'reset-passw0rd' },
        });
        expect(login.status()).toBe(200);
      } finally {
        await anon.dispose();
      }
    } finally {
      await ctx
        .post('/api/v1/admin/users/delete', { data: { username } })
        .catch(() => undefined);
      await ctx.dispose();
    }
  });
});
