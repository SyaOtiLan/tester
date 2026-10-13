/**
 * warehouse — revoked AccessKey is rejected (WH-API-029).
 *
 * Lifecycle: create a WebDAV AccessKey bound to /personal, confirm it
 * authenticates a PROPFIND (207), revoke it, then confirm the same key/secret
 * is now rejected (401/403).
 *
 * Requires:
 *   - WAREHOUSE_WEBDAV_URL   (backend API+WebDAV origin, e.g. http://localhost:6065)
 *   - one working credential for acquireToken() (WAREHOUSE_USER+PASS / AUTH_TOKEN / WALLET_PRIVATE_KEY)
 *
 * Optional:
 *   - WAREHOUSE_WEBDAV_PREFIX  (defaults to /dav)
 */
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

test.describe("【WebDAV 目录访问密钥】WebDAV AccessKey 撤销（WebDAV AccessKey revocation）", () => {
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

  test("【WebDAV 目录访问密钥(AccessKey) / API】 WH-API-029 撤销后 AccessKey 认证被拒", async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!hasCredential(), 'no warehouse credential configured');

    const tokens = await acquireToken(apiBase()!);
    const prefix = envFor('warehouse')['WAREHOUSE_WEBDAV_PREFIX'] ?? '/dav';

    // 1) create the AccessKey bound to /personal
    const mgmt = await authedRequest(apiBase()!, tokens.token);
    try {
      const res = await mgmt.post('/api/v1/public/webdav/access-keys/create', {
        data: {
          name: `e2e-revoke-${Date.now()}`,
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

    // 2) active key authenticates PROPFIND (207) — precondition
    const active = await webdavPropfind({
      baseURL: apiBase()!,
      prefix,
      path: '/personal',
      auth,
      depth: 1,
    });
    expect(active.status()).toBe(207);

    // 3) revoke it
    const revokeCtx = await authedRequest(apiBase()!, tokens.token);
    try {
      const revokeRes = await revokeCtx.post('/api/v1/public/webdav/access-keys/revoke', {
        data: { id: created!.id },
      });
      expect(revokeRes.status()).toBe(200);
    } finally {
      await revokeCtx.dispose();
    }

    // 4) same key/secret now rejected
    const afterRevoke = await webdavPropfind({
      baseURL: apiBase()!,
      prefix,
      path: '/personal',
      auth,
      depth: 1,
    });
    expectStatus(afterRevoke, [401, 403]);
  });
});
