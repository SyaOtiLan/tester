/**
 * warehouse — directed (user) share (WH-API-049, WH-API-055).
 *
 * Owner (via acquireToken) shares an owned file to a specific audience (a second
 * real user identified by WAREHOUSE_WALLET_PRIVATE_KEY) with read-only
 * permissions. Then:
 *   - WH-API-049: the create call returns the share item with the granted
 *     permission set and an "addresses" audience.
 *   - WH-API-055: the audience, acting under its own JWT, attempts a write
 *     (create folder) and is denied with 403 "permission denied".
 *
 * Requires:
 *   - WAREHOUSE_WEBDAV_URL          (backend API+WebDAV origin, e.g. http://localhost:6065)
 *   - WAREHOUSE_WALLET_PRIVATE_KEY  (the target/audience user; auto-created on first SIWE login)
 *   - one working credential for acquireToken() as the owner
 *     (WAREHOUSE_USER+PASS / WAREHOUSE_AUTH_TOKEN / WAREHOUSE_WALLET_PRIVATE_KEY)
 *
 * Verified source behavior (handler/share_user.go, share_user_service.go):
 *   - POST /share/user/create (targetMode "addresses") requires each target
 *     address to be an existing user; returns top-level
 *     { id, permissions, targetType:"addresses", audienceCount, ... }.
 *   - POST /share/user/folder checks the stored permission set and returns
 *     403 "permission denied" when "create" is not granted.
 */
import { test, expect, envFor } from '../fixtures';
import { acquireToken, loginWithWallet, authedRequest } from '../helpers/auth';
import {
  createDirectedShare,
  putOwnedFile,
  revokeDirectedShare,
  type DirectedShare,
} from '../helpers/share';

function apiBase(): string | undefined {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_URL'];
}
function targetKey(): string | undefined {
  return envFor('warehouse')['WAREHOUSE_WALLET_PRIVATE_KEY'];
}
function hasOwnerCredential(): boolean {
  const env = envFor('warehouse');
  return Boolean(
    env['WAREHOUSE_AUTH_TOKEN'] ||
      (env['WAREHOUSE_USER'] && env['WAREHOUSE_PASS']) ||
      env['WAREHOUSE_WALLET_PRIVATE_KEY'],
  );
}

test.describe("【文件分享】directed (user) share（directed (user) share）", () => {
  test.describe.configure({ mode: 'serial' });
  let ownerToken = '';
  let targetToken = '';
  let share: DirectedShare | null = null;
  const stamp = Date.now();

  test.afterAll(async () => {
    if (!apiBase() || !ownerToken || !share) return;
    await revokeDirectedShare(apiBase()!, ownerToken, share.id);
  });

  test("【定向分享(给指定用户) / API】 WH-API-049 创建定向分享给指定受众", async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!hasOwnerCredential(), 'no warehouse owner credential configured');
    test.skip(!targetKey(), 'WAREHOUSE_WALLET_PRIVATE_KEY (target audience) not configured');

    ownerToken = (await acquireToken(apiBase()!)).token;
    const target = await loginWithWallet(apiBase()!, targetKey()!);
    targetToken = target.token;

    const path = await putOwnedFile(
      apiBase()!,
      ownerToken,
      `e2e-directed-${stamp}.txt`,
      `directed-${stamp}`,
    );

    share = await createDirectedShare(apiBase()!, ownerToken, {
      path,
      targetAddresses: [target.address],
      permissions: ['read'],
      expiresValue: 1,
      expiresUnit: 'day',
    });

    expect(share.id).toMatch(/^[0-9a-f-]{16,}$/);
    expect(share.permissions).toEqual(['read']);
    expect(share.targetType).toBe('addresses');
    expect(share.audienceCount).toBeGreaterThanOrEqual(1);
  });

  test("【定向分享(给指定用户) / API】 WH-API-055 只读定向分享的写操作被拒", async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!share, 'previous test did not create a directed share');
    test.skip(!targetToken, 'target audience JWT unavailable');

    const ctx = await authedRequest(apiBase()!, targetToken);
    try {
      const res = await ctx.post('/api/v1/public/share/user/folder', {
        data: { shareId: share!.id, path: `blocked-${stamp}` },
      });
      expect(res.status()).toBe(403);
      expect((await res.text()).toLowerCase()).toContain('permission denied');
    } finally {
      await ctx.dispose();
    }
  });
});
