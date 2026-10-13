/**
 * warehouse — S3 Credential (ak/sk for the S3-compatible endpoint on :6066).
 *
 * Steps:
 *   1. password login → JWT
 *   2. POST /api/v1/public/s3/credentials/create with rootPath=/personal
 *   3. expect a returned accessKeyId + secret
 *   4. list, revoke, then delete via the management API
 *
 * Note: signing requests against the S3 endpoint requires AWS Signature V4.
 * We test the lifecycle through the management API and confirm the endpoint
 * at 6066 is wired (returns 403 instead of connection-refused).
 */
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { acquireToken, authedRequest } from '../helpers/auth';

interface CreateS3CredentialResponse {
  id: string;
  accessKeyId: string;
  secret: string;
  rootPath?: string;
  status: string;
  name: string;
}

interface ListS3CredentialResponse {
  items: Array<{
    id: string;
    accessKeyId: string;
    name: string;
    rootPath?: string;
    status: string;
  }>;
}

function skipIfNoService() {
  test.skip(!baseURLFor('warehouse'), 'WAREHOUSE_BASE_URL not configured');
}

test.describe("【S3 凭证与 S3 协议】S3 凭证生命周期（S3 Credential lifecycle）", () => {
  test.describe.configure({ mode: 'serial' });
  let created: { id: string; accessKeyId: string } | null = null;

  test.afterAll(async () => {
    if (!created) return;
    const tokens = await acquireToken(baseURLFor('warehouse')!);
    const ctx = await authedRequest(baseURLFor('warehouse')!, tokens.token);
    try {
      await ctx.post('/api/v1/public/s3/credentials/delete', {
        data: { id: created.id },
      });
    } finally {
      await ctx.dispose();
    }
  });

  test("【S3 凭证与 S3 协议 / API】 S3 服务端点可通过端口 6066 访问", async () => {
    skipIfNoService();
    const env = envFor('warehouse');
    test.skip(!env['WAREHOUSE_ADMIN_URL'], 'WAREHOUSE_ADMIN_URL (6066) not configured');
    // Unsigned GET to the S3 service — should respond 403 AccessDenied, not 0/connect-refused.
    const res = await fetch(env['WAREHOUSE_ADMIN_URL']!, { method: 'GET' });
    expect([403, 405]).toContain(res.status);
  });

  test("【S3 凭证与 S3 协议 / API】 在 /personal 下创建 S3 凭证返回 AK + Secret", async () => {
    skipIfNoService();
    const tokens = await acquireToken(baseURLFor('warehouse')!);
    const ctx = await authedRequest(baseURLFor('warehouse')!, tokens.token);
    try {
      const res = await ctx.post('/api/v1/public/s3/credentials/create', {
        data: {
          name: `e2e-s3-${Date.now()}`,
          rootPath: '/personal',
          permissions: ['read', 'create', 'update', 'delete'],
        },
      });
      expect(res.status()).toBe(200);
      const body = (await res.json()) as CreateS3CredentialResponse;
      expect(body.id).toMatch(/^[0-9a-f-]{8,}$/);
      expect(body.accessKeyId).toMatch(/^AK[A-Za-z0-9_-]{6,}$/);
      expect(body.secret.length).toBeGreaterThanOrEqual(16);
      expect(body.status).toBeTruthy();
      created = { id: body.id, accessKeyId: body.accessKeyId };
    } finally {
      await ctx.dispose();
    }
  });

  test("【S3 凭证与 S3 协议 / API】 列表返回我们创建的 S3 凭证", async () => {
    skipIfNoService();
    test.skip(!created, 'previous test did not create an S3 Credential');
    const tokens = await acquireToken(baseURLFor('warehouse')!);
    const ctx = await authedRequest(baseURLFor('warehouse')!, tokens.token);
    try {
      const res = await ctx.get('/api/v1/public/s3/credentials/list');
      expect(res.status()).toBe(200);
      const body = (await res.json()) as ListS3CredentialResponse;
      expect(body.items.find((c) => c.id === created!.id)).toBeDefined();
    } finally {
      await ctx.dispose();
    }
  });

  test("【S3 凭证与 S3 协议 / API】 撤销+删除 S3 凭证", async () => {
    skipIfNoService();
    test.skip(!created, 'previous test did not create an S3 Credential');
    const tokens = await acquireToken(baseURLFor('warehouse')!);
    const ctx = await authedRequest(baseURLFor('warehouse')!, tokens.token);
    try {
      const revokeRes = await ctx.post('/api/v1/public/s3/credentials/revoke', {
        data: { id: created!.id },
      });
      expect(revokeRes.status()).toBe(200);
      const deleteRes = await ctx.post('/api/v1/public/s3/credentials/delete', {
        data: { id: created!.id },
      });
      expect(deleteRes.status()).toBe(200);
      created = null;
    } finally {
      await ctx.dispose();
    }
  });
});
