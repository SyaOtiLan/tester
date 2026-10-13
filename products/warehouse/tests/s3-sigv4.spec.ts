/**
 * warehouse — SigV4 ListBuckets succeeds (WH-API-037).
 *
 * Create an S3 credential via the management API (on 6065), then issue a
 * manually AWS Signature V4-signed GET / (ListBuckets) against the S3 server
 * (6066). A correct signature must yield 200 with <ListAllMyBucketsResult>.
 *
 * Requires:
 *   - WAREHOUSE_WEBDAV_URL   (management API origin, e.g. http://localhost:6065)
 *   - WAREHOUSE_ADMIN_URL    (S3 endpoint origin, e.g. http://localhost:6066)
 *   - one working credential for acquireToken() (WAREHOUSE_USER+PASS / AUTH_TOKEN / WALLET_PRIVATE_KEY)
 *
 * Source: s3/signature_v4.go verifies header-form SigV4 (region us-east-1,
 * service s3, signed headers host;x-amz-content-sha256;x-amz-date); s3/server.go
 * ListBuckets returns <ListAllMyBucketsResult> for the credential's visible buckets.
 */
import { test, expect, envFor } from '../fixtures';
import { acquireToken, authedRequest } from '../helpers/auth';
import { signSigV4 } from '../helpers/sigv4';

function apiBase(): string | undefined {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_URL'];
}
function s3Base(): string | undefined {
  return envFor('warehouse')['WAREHOUSE_ADMIN_URL'];
}
function hasCredential(): boolean {
  const env = envFor('warehouse');
  return Boolean(
    env['WAREHOUSE_AUTH_TOKEN'] ||
      (env['WAREHOUSE_USER'] && env['WAREHOUSE_PASS']) ||
      env['WAREHOUSE_WALLET_PRIVATE_KEY'],
  );
}

test.describe("【S3 凭证与 S3 协议】S3 SigV4 ListBuckets（S3 SigV4 ListBuckets）", () => {
  test.describe.configure({ mode: 'serial' });
  let created: { id: string; accessKeyId: string; secret: string } | null = null;

  test.afterAll(async () => {
    if (!created || !apiBase()) return;
    const tokens = await acquireToken(apiBase()!);
    const ctx = await authedRequest(apiBase()!, tokens.token);
    try {
      await ctx.post('/api/v1/public/s3/credentials/delete', { data: { id: created.id } });
    } finally {
      await ctx.dispose();
    }
  });

  test("【S3 凭证与 S3 协议 / API】 WH-API-037 SigV4 ListBuckets 成功", async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!s3Base(), 'WAREHOUSE_ADMIN_URL (S3 endpoint) not configured');
    test.skip(!hasCredential(), 'no warehouse credential configured');

    const tokens = await acquireToken(apiBase()!);
    const mgmt = await authedRequest(apiBase()!, tokens.token);
    try {
      const res = await mgmt.post('/api/v1/public/s3/credentials/create', {
        data: {
          name: `e2e-sigv4-${Date.now()}`,
          rootPath: '/personal',
          permissions: ['read', 'create', 'update', 'delete'],
        },
      });
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { id: string; accessKeyId: string; secret: string };
      created = { id: body.id, accessKeyId: body.accessKeyId, secret: body.secret };
    } finally {
      await mgmt.dispose();
    }

    const signed = signSigV4({
      method: 'GET',
      endpoint: s3Base()!,
      path: '/',
      accessKeyId: created!.accessKeyId,
      secret: created!.secret,
    });

    const s3Res = await fetch(signed.url, { method: 'GET', headers: signed.headers });
    expect(s3Res.status).toBe(200);
    const xml = await s3Res.text();
    expect(xml).toContain('<ListAllMyBucketsResult>');
    // credential is bound to /personal → the "personal" bucket must be visible
    expect(xml).toContain('<Bucket>');
  });
});
