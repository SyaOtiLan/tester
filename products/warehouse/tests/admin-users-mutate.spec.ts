/**
 * warehouse — admin updates and deletes a user (WH-API-074).
 *
 * Complements admin-users.spec.ts (list/create/reset-password) with the
 * mutate-and-remove half of the admin user lifecycle:
 *
 *   1. create a throwaway user (with an initial quota).
 *   2. POST /api/v1/admin/users/update {username, quota} → 200, the returned
 *      record shows the new quota.
 *   3. POST /api/v1/admin/users/delete {username} → 200; it disappears from
 *      /api/v1/admin/users/list.
 *
 * These endpoints sit behind AdminMiddleware (Security.AdminAddresses). We gate
 * on the authoritative capabilities.manageUsers from /webdav/user/info so the
 * case runs for real against an admin identity and skips cleanly — never
 * faked — when the configured identity is not an admin (the common case here,
 * where the password `admin` account is NOT in the allowlist).
 *
 * Requires WAREHOUSE_WEBDAV_URL + a credential whose wallet is an admin.
 *
 * Source: web/src/api/index.ts adminUserApi.updateQuota (POST update
 * {username,quota}→AdminUserItem); handler/admin_user.go HandleDelete
 * {username}, HandleList {items}.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, envFor } from '../fixtures';
import { acquireToken, authedRequest, getUserInfo } from '../helpers/auth';

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

interface AdminUserItem {
  username: string;
  quota?: number;
}

test(localizedTitle("【管理员用户管理 / API】 WH-API-074 管理员更新/删除用户", "WH-API-074 an admin can update and delete a user"), async () => {
  test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
  test.skip(!hasCredential(), 'no warehouse credential configured');

  const adminToken = (await acquireToken(apiBase()!)).token;
  const info = await getUserInfo(apiBase()!, adminToken);
  test.skip(
    !info.capabilities.manageUsers,
    'configured warehouse identity is not an admin (wallet not in Security.AdminAddresses); admin endpoints are 403 for it',
  );

  const username = `e2e-admin-mutate-${Date.now()}`;
  const ctx = await authedRequest(apiBase()!, adminToken);
  try {
    // 1) provision a throwaway user
    const create = await ctx.post('/api/v1/admin/users/create', {
      data: { username, password: 'e2e-passw0rd', quota: 1073741824 },
    });
    expect(create.status()).toBe(201);

    // 2) update its quota
    const newQuota = 2147483648;
    const update = await ctx.post('/api/v1/admin/users/update', {
      data: { username, quota: newQuota },
    });
    expect(update.status()).toBe(200);
    const updated = (await update.json()) as AdminUserItem;
    expect(updated.username).toBe(username);
    if (typeof updated.quota === 'number') {
      expect(updated.quota).toBe(newQuota);
    }

    // 3) delete it
    const del = await ctx.post('/api/v1/admin/users/delete', { data: { username } });
    expect(del.status()).toBe(200);

    // it is gone from the listing
    const list = await ctx.get('/api/v1/admin/users/list');
    expect(list.status()).toBe(200);
    const items = ((await list.json()) as { items: AdminUserItem[] }).items;
    expect(items.find((u) => u.username === username)).toBeFalsy();
  } finally {
    // best-effort cleanup if an assertion aborted before delete
    await ctx.post('/api/v1/admin/users/delete', { data: { username } }).catch(() => undefined);
    await ctx.dispose();
  }
});
