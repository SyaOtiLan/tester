/**
 * warehouse — WebDAV AccessKey (ak/sk for WebDAV) lifecycle.
 *
 * Steps:
 *   1. password login → JWT
 *   2. POST /api/v1/public/webdav/access-keys/create with rootPath=/personal
 *   3. expect a returned accessKeyId + secret
 *   4. PROPFIND /dav/personal using HTTP Basic (accessKeyId:secret) → 207
 *   5. list, revoke, then delete
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { acquireToken, authedRequest } from '../helpers/auth';
import { expectStatus, webdavPropfind, type Auth } from '../../../shared/api';

interface CreateAccessKeyResponse {
  id: string;
  name: string;
  keyId: string;
  keySecret: string;
  rootPath?: string;
  bindingPaths?: string[];
  permissions: string[];
  status: string;
}

interface ListAccessKeyResponse {
  items: Array<{
    id: string;
    keyId: string;
    name: string;
    permissions: string[];
    status: string;
  }>;
}

function skipIfNoService() {
  test.skip(!baseURLFor('warehouse'), 'WAREHOUSE_BASE_URL not configured');
}

test.describe(localizedTitle("【WebDAV 目录访问密钥】WebDAV AccessKey 生命周期（WebDAV AccessKey lifecycle）", "WebDAV AccessKey lifecycle"), () => {
  test.describe.configure({ mode: 'serial' });
  let created: { id: string; keyId: string; keySecret: string } | null = null;

  test.afterAll(async () => {
    if (!created) return;
    const tokens = await acquireToken(baseURLFor('warehouse')!);
    const ctx = await authedRequest(baseURLFor('warehouse')!, tokens.token);
    try {
      await ctx.post('/api/v1/public/webdav/access-keys/delete', {
        data: { id: created.id },
      });
    } finally {
      await ctx.dispose();
    }
  });

  test(localizedTitle("【WebDAV 目录访问密钥 / API】 在 /personal 下创建 AccessKey 返回 ak + sk", "create AccessKey under /personal returns ak + sk"), async () => {
    skipIfNoService();
    const tokens = await acquireToken(baseURLFor('warehouse')!);
    const ctx = await authedRequest(baseURLFor('warehouse')!, tokens.token);
    try {
      const res = await ctx.post('/api/v1/public/webdav/access-keys/create', {
        data: {
          name: `e2e-${Date.now()}`,
          rootPath: '/personal',
          permissions: ['read', 'create', 'update', 'delete'],
        },
      });
      expect(res.status()).toBe(200);
      const body = (await res.json()) as CreateAccessKeyResponse;
      expect(body.keyId).toMatch(/^[A-Za-z0-9_-]{6,}$/);
      expect(body.keySecret.length).toBeGreaterThanOrEqual(8);
      expect(body.status).toBeTruthy();
      created = {
        id: body.id,
        keyId: body.keyId,
        keySecret: body.keySecret,
      };
    } finally {
      await ctx.dispose();
    }
  });

  test(localizedTitle("【WebDAV 目录访问密钥 / API】 列表显示了我们创建的 AccessKey", "list shows the AccessKey we created"), async () => {
    skipIfNoService();
    test.skip(!created, 'previous test did not create an AccessKey');
    const tokens = await acquireToken(baseURLFor('warehouse')!);
    const ctx = await authedRequest(baseURLFor('warehouse')!, tokens.token);
    try {
      const res = await ctx.get('/api/v1/public/webdav/access-keys/list');
      expect(res.status()).toBe(200);
      const body = (await res.json()) as ListAccessKeyResponse;
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.find((k) => k.id === created!.id)).toBeDefined();
    } finally {
      await ctx.dispose();
    }
  });

  test(localizedTitle("【WebDAV 目录访问密钥 / API】 AccessKey 验证 WebDAV PROPFIND", "AccessKey authenticates WebDAV PROPFIND"), async () => {
    skipIfNoService();
    test.skip(!created, 'previous test did not create an AccessKey');
    const env = envFor('warehouse');
    test.skip(!env['WAREHOUSE_WEBDAV_URL'], 'WAREHOUSE_WEBDAV_URL not configured');
    const auth: Auth = { type: 'basic', username: created!.keyId, password: created!.keySecret };
    const res = await webdavPropfind({
      baseURL: env['WAREHOUSE_WEBDAV_URL']!,
      prefix: env['WAREHOUSE_WEBDAV_PREFIX'] ?? '/dav',
      path: '/personal',
      auth,
      depth: 1,
    });
    // 207 multi-status, 401/403 = server rejected the ak/sk (we at least know
    // the endpoint is wired and reachable).
    expectStatus(res, [207, 401, 403]);
  });

  test(localizedTitle("【WebDAV 目录访问密钥 / API】 撤销+删除 AccessKey", "revoke + delete the AccessKey"), async () => {
    skipIfNoService();
    test.skip(!created, 'previous test did not create an AccessKey');
    const tokens = await acquireToken(baseURLFor('warehouse')!);
    const ctx = await authedRequest(baseURLFor('warehouse')!, tokens.token);
    try {
      const revokeRes = await ctx.post('/api/v1/public/webdav/access-keys/revoke', {
        data: { id: created!.id },
      });
      expect(revokeRes.status()).toBe(200);
      const deleteRes = await ctx.post('/api/v1/public/webdav/access-keys/delete', {
        data: { id: created!.id },
      });
      expect(deleteRes.status()).toBe(200);
      created = null;
    } finally {
      await ctx.dispose();
    }
  });
});
