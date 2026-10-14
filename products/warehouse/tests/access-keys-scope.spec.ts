/**
 * warehouse — AccessKey cannot reach an unbound path (WH-API-030).
 *
 * An AccessKey created with rootPath=/personal is scoped (via generated Rules)
 * to that subtree only. A WebDAV PROPFIND on a path outside the binding must be
 * rejected by the permission check with 403, even though the credential itself
 * authenticates.
 *
 * Requires:
 *   - WAREHOUSE_WEBDAV_URL (backend API+WebDAV origin, e.g. http://localhost:6065)
 *   - one working credential for acquireToken()
 *
 * Source: access_key_authenticator.go builds scoped Rules limited to the bound
 * paths; webdav_service.checkPermission → 403 when CanAccess is false.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, envFor } from '../fixtures';
import { acquireToken, authedRequest } from '../helpers/auth';
import { expectStatus, webdavPropfind, type Auth } from '../../../shared/api';

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

test.describe(localizedTitle("【WebDAV 目录访问密钥】AccessKey 路径范围（AccessKey path scope）", "AccessKey path scope"), () => {
  test.describe.configure({ mode: 'serial' });
  let created: { id: string; keyId: string; keySecret: string } | null = null;

  test.afterAll(async () => {
    if (!created || !apiBase()) return;
    const tokens = await acquireToken(apiBase()!);
    const ctx = await authedRequest(apiBase()!, tokens.token);
    try {
      await ctx.post('/api/v1/public/webdav/access-keys/delete', { data: { id: created.id } });
    } finally {
      await ctx.dispose();
    }
  });

  test(localizedTitle("【WebDAV 目录访问密钥(AccessKey) / API】 WH-API-030 AccessKey 访问未绑定路径被拒", "WH-API-030 AccessKey bound to /personal is denied on an unbound path"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!hasCredential(), 'no warehouse credential configured');

    const tokens = await acquireToken(apiBase()!);
    const prefix = envFor('warehouse')['WAREHOUSE_WEBDAV_PREFIX'] ?? '/dav';

    const mgmt = await authedRequest(apiBase()!, tokens.token);
    try {
      const res = await mgmt.post('/api/v1/public/webdav/access-keys/create', {
        data: {
          name: `e2e-scope-${Date.now()}`,
          rootPath: '/personal',
          permissions: ['read', 'create', 'update', 'delete'],
        },
      });
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { id: string; keyId: string; keySecret: string };
      created = { id: body.id, keyId: body.keyId, keySecret: body.keySecret };
    } finally {
      await mgmt.dispose();
    }

    const auth: Auth = { type: 'basic', username: created!.keyId, password: created!.keySecret };

    // Precondition: the key works on its bound path.
    const bound = await webdavPropfind({
      baseURL: apiBase()!,
      prefix,
      path: '/personal',
      auth,
      depth: 1,
    });
    expect(bound.status()).toBe(207);

    // An unbound top-level path is rejected with 403 (out of scope).
    const unbound = await webdavPropfind({
      baseURL: apiBase()!,
      prefix,
      path: `/e2e-unbound-${Date.now()}`,
      auth,
      depth: 1,
    });
    expectStatus(unbound, [403]);
  });
});
