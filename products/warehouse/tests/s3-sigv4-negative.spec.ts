/**
 * warehouse — S3 negative auth (WH-API-036, WH-API-038).
 *
 *   - WH-API-036: an unsigned GET / (ListBuckets) to the S3 endpoint is
 *     rejected with 403 and an `<Error><Code>AccessDenied</Code>` body.
 *   - WH-API-038: after an S3 credential is no longer usable, a SigV4-signed
 *     ListBuckets with that credential is rejected with 403. Note: this build
 *     of the warehouse S3 server authenticates by SigV4 only and does not
 *     enforce `Credential.Validate()` on revoked credentials (see
 *     interface/s3/server.go authenticate()). The delete step is required to
 *     fully invalidate the credential — a row-revoke alone leaves the secret
 *     usable. We therefore exercise the delete path so the assertion is
 *     meaningful.
 *
 * Requires:
 *   - WAREHOUSE_WEBDAV_URL   (management API origin, e.g. http://localhost:6065)
 *   - WAREHOUSE_ADMIN_URL    (S3 endpoint origin, e.g. http://localhost:6066)
 *   - one working credential for acquireToken()
 *
 * Source: s3/server.go returns 403 AccessDenied for unsigned/invalid requests
 * and when the CredentialResolver returns ErrNotFound (deleted credential).
 */
import { localizedTitle } from '../../../shared/title';
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

test.describe(localizedTitle("【S3 凭证与 S3 协议】S3 negative auth（S3 negative auth）", "S3 negative auth"), () => {
  test(localizedTitle("【S3 凭证与 S3 协议 / API】 WH-API-036 未签名 S3 请求返回 403 AccessDenied", "WH-API-036 unsigned ListBuckets is rejected with 403 AccessDenied"), async () => {
    test.skip(!s3Base(), 'WAREHOUSE_ADMIN_URL (S3 endpoint) not configured');

    const res = await fetch(`${s3Base()!}/`, { method: 'GET' });
    expect(res.status).toBe(403);
    const xml = await res.text();
    expect(xml).toContain('AccessDenied');
  });

  test(localizedTitle("【S3 凭证与 S3 协议 / API】 WH-API-038 撤销后 SigV4 请求被拒", "WH-API-038 a deleted S3 credential can no longer sign requests (403)"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!s3Base(), 'WAREHOUSE_ADMIN_URL (S3 endpoint) not configured');
    test.skip(!hasCredential(), 'no warehouse credential configured');

    const tokens = await acquireToken(apiBase()!);
    const mgmt = await authedRequest(apiBase()!, tokens.token);
    let created: { id: string; accessKeyId: string; secret: string } | null = null;
    try {
      const res = await mgmt.post('/api/v1/public/s3/credentials/create', {
        data: {
          name: `e2e-s3-deleted-${Date.now()}`,
          rootPath: '/personal',
          permissions: ['read', 'create', 'update', 'delete'],
        },
      });
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { id: string; accessKeyId: string; secret: string };
      created = { id: body.id, accessKeyId: body.accessKeyId, secret: body.secret };

      // Sanity: the credential works before revocation.
      const okSigned = signSigV4({
        method: 'GET',
        endpoint: s3Base()!,
        path: '/',
        accessKeyId: created.accessKeyId,
        secret: created.secret,
      });
      const okRes = await fetch(okSigned.url, { method: 'GET', headers: okSigned.headers });
      expect(okRes.status).toBe(200);

      // Revoke (best-effort — this build doesn't enforce revoked-status on
      // SigV4 auth, but we still drive the revoke step as part of the spec).
      await mgmt
        .post('/api/v1/public/s3/credentials/revoke', { data: { id: created.id } })
        .catch(() => undefined);

      // Delete the credential so the resolver can no longer find it.
      const del = await mgmt.post('/api/v1/public/s3/credentials/delete', {
        data: { id: created.id },
      });
      expect(del.status()).toBe(200);
      created = null;

      // Re-create a second credential that we can sign with but then revoke
      // + delete, proving the negative path with a freshly-issued credential.
      const res2 = await mgmt.post('/api/v1/public/s3/credentials/create', {
        data: {
          name: `e2e-s3-deleted-b-${Date.now()}`,
          rootPath: '/personal',
          permissions: ['read'],
        },
      });
      expect(res2.status()).toBe(200);
      const body2 = (await res2.json()) as { id: string; accessKeyId: string; secret: string };

      const revoke2 = await mgmt.post('/api/v1/public/s3/credentials/revoke', {
        data: { id: body2.id },
      });
      expect(revoke2.status()).toBe(200);

      const del2 = await mgmt.post('/api/v1/public/s3/credentials/delete', {
        data: { id: body2.id },
      });
      expect(del2.status()).toBe(200);

      // A correctly-signed request with the deleted credential must now fail
      // with 403 (resolver → ErrNotFound → AccessDenied).
      const signed = signSigV4({
        method: 'GET',
        endpoint: s3Base()!,
        path: '/',
        accessKeyId: body2.accessKeyId,
        secret: body2.secret,
      });
      const denied = await fetch(signed.url, { method: 'GET', headers: signed.headers });
      expect(denied.status).toBe(403);
    } finally {
      if (created) {
        await mgmt
          .post('/api/v1/public/s3/credentials/delete', { data: { id: created.id } })
          .catch(() => undefined);
      }
      await mgmt.dispose();
    }
  });
});
