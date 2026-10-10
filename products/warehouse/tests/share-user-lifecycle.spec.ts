/**
 * warehouse — directed (user) share lifecycle (WH-API-050, 051, 052, 054).
 *
 * Owner (acquireToken) shares an owned file to a separate, stable SIWE test
 * identity and then:
 *   - WH-API-050: GET /share/user/list returns the share to the owner.
 *   - WH-API-051: GET /share/user/received returns the shared resource to the
 *     target.
 *   - WH-API-054: GET /share/user/entries?shareId=&path= lets the target browse
 *     the shared resource.
 *   - WH-API-052: after POST /share/user/revoke, the target can no longer read
 *     the entries (404).
 *
 * Requires:
 *   - WAREHOUSE_WEBDAV_URL          (backend API+WebDAV origin)
 *   - WAREHOUSE_WALLET_PRIVATE_KEY  (used to derive a separate test identity)
 *   - one working owner credential for acquireToken()
 *
 * Source: handler/share_user.go HandleListMine {items:[{id,...}]},
 * HandleListReceived {items:[{resourceId,name,path,...}]}, HandleEntries
 * (?shareId=&path=) {items:[...]}, HandleRevoke {id}; a revoked share resolves
 * to ErrShareNotFound → 404.
 */
import { createHmac } from 'node:crypto';
import { test, expect, envFor } from '../fixtures';
import { acquireToken, loginWithWallet, authedRequest } from '../helpers/auth';
import { createDirectedShare, putOwnedFile, revokeDirectedShare } from '../helpers/share';

function apiBase(): string | undefined {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_URL'];
}
function targetKey(): string | undefined {
  const key = envFor('warehouse')['WAREHOUSE_WALLET_PRIVATE_KEY'];
  // Reuse one distinct test account across runs instead of creating a new
  // account each time. Never log or persist the derived private key.
  return key
    ? `0x${createHmac('sha256', key).update('warehouse-directed-share-target-v1').digest('hex')}`
    : undefined;
}
function hasOwnerCredential(): boolean {
  const env = envFor('warehouse');
  return Boolean(
    env['WAREHOUSE_AUTH_TOKEN'] ||
    (env['WAREHOUSE_USER'] && env['WAREHOUSE_PASS']) ||
    env['WAREHOUSE_WALLET_PRIVATE_KEY'],
  );
}
function skipGuards() {
  test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
  test.skip(!hasOwnerCredential(), 'no warehouse owner credential configured');
  test.skip(!targetKey(), 'WAREHOUSE_WALLET_PRIVATE_KEY not configured');
}

test.describe('directed share lifecycle', () => {
  test.describe.configure({ mode: 'serial' });
  const stamp = Date.now();
  let ownerToken = '';
  let targetToken = '';
  let targetAddress = '';
  let shareId = '';
  const fileName = `e2e-directed-life-${stamp}.txt`;

  test.beforeAll(async () => {
    if (!apiBase() || !hasOwnerCredential() || !targetKey()) return;
    ownerToken = (await acquireToken(apiBase()!)).token;
    // The configured owner credentials and wallet can resolve to the same
    // account. Derive a different, stable test-only identity for the audience.
    const target = await loginWithWallet(apiBase()!, targetKey()!);
    targetToken = target.token;
    targetAddress = target.address;
    const path = await putOwnedFile(apiBase()!, ownerToken, fileName, `life-${stamp}`);
    const share = await createDirectedShare(apiBase()!, ownerToken, {
      path,
      targetAddresses: [targetAddress],
      permissions: ['read'],
      expiresValue: 1,
      expiresUnit: 'day',
    });
    shareId = share.id;
  });

  test.afterAll(async () => {
    if (apiBase() && ownerToken && shareId) {
      await revokeDirectedShare(apiBase()!, ownerToken, shareId).catch(() => undefined);
    }
  });

  test('WH-API-050 the owner sees the directed share in their list', async () => {
    skipGuards();
    const ctx = await authedRequest(apiBase()!, ownerToken);
    try {
      const res = await ctx.get('/api/v1/public/share/user/list');
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { items: Array<{ id: string }> };
      expect(body.items.find((i) => i.id === shareId)).toBeTruthy();
    } finally {
      await ctx.dispose();
    }
  });

  test('WH-API-051 the target can list the resources shared to them', async () => {
    skipGuards();
    const ctx = await authedRequest(apiBase()!, targetToken);
    try {
      const res = await ctx.get('/api/v1/public/share/user/received');
      expect(res.status()).toBe(200);
      const body = (await res.json()) as {
        items: Array<{ resourceId: string; name: string; path: string; permissions: string[] }>;
      };
      expect(Array.isArray(body.items)).toBe(true);
      const received = body.items.find((item) => item.path === `/${fileName}`);
      expect(received).toBeTruthy();
      expect(received?.name).toBe(fileName);
      expect(received?.resourceId).toBeTruthy();
      expect(received?.permissions).toContain('read');
    } finally {
      await ctx.dispose();
    }
  });

  test('WH-API-054 the target can browse the shared entries', async () => {
    skipGuards();
    const ctx = await authedRequest(apiBase()!, targetToken);
    try {
      const res = await ctx.get(
        `/api/v1/public/share/user/entries?shareId=${encodeURIComponent(shareId)}&path=`,
      );
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { items: unknown[] };
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.length).toBeGreaterThanOrEqual(1);
    } finally {
      await ctx.dispose();
    }
  });

  test('WH-API-052 a revoked directed share is no longer accessible to the target', async () => {
    skipGuards();
    await revokeDirectedShare(apiBase()!, ownerToken, shareId);
    const revokedId = shareId;
    shareId = ''; // prevent afterAll double-revoke

    const ctx = await authedRequest(apiBase()!, targetToken);
    try {
      const res = await ctx.get(
        `/api/v1/public/share/user/entries?shareId=${encodeURIComponent(revokedId)}&path=`,
      );
      expect([403, 404, 410]).toContain(res.status());
    } finally {
      await ctx.dispose();
    }
  });
});
