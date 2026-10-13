/**
 * warehouse — directed-share extras (WH-API-048, WH-API-053).
 *
 *   - WH-API-048 二次分享: a user who has received a resource can re-share a
 *     file inside it. As the wallet audience: GET /share/user/received to pick
 *     a granted resource, browse it via /share/resource/entries to find a real
 *     file, then POST /share/create-from-resource {resourceId, relativePath} —
 *     which returns a fresh public share (token + url) for that file.
 *   - WH-API-053 audiences: GET /share/user/audiences?shareId=<id> returns the
 *     audience list of a directed share (the wallets/users it targets). We
 *     create a directed share to the wallet identity and assert its address is
 *     listed.
 *
 * Requires:
 *   - WAREHOUSE_WEBDAV_URL
 *   - WAREHOUSE_WALLET_PRIVATE_KEY (the audience identity; has standing grants)
 *   - one working owner credential for acquireToken()
 *
 * Source: share_user.go HandleAudiences (?shareId=, {items:[{type,targetWallet,
 * ...}]}); share.go HandleCreateFromResource ({resourceId, relativePath} →
 * public-share item). WH-API-048 skips cleanly if the audience has no received
 * resource containing a browsable file.
 */
import { test, expect, envFor } from '../fixtures';
import { acquireToken, loginWithWallet, authedRequest } from '../helpers/auth';
import { createDirectedShare, putOwnedFile, revokeDirectedShare } from '../helpers/share';

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

test("【公开分享 / API】 WH-API-048 从收到的资源二次分享", async () => {
  test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
  test.skip(!targetKey(), 'WAREHOUSE_WALLET_PRIVATE_KEY (audience identity) not configured');

  const audience = await loginWithWallet(apiBase()!, targetKey()!);
  const ctx = await authedRequest(apiBase()!, audience.token);
  try {
    const recvRes = await ctx.get('/api/v1/public/share/user/received');
    expect(recvRes.status()).toBe(200);
    const received = (await recvRes.json()) as {
      items: Array<{ resourceId: string; name: string }>;
    };

    // Find a received resource that has a browsable file inside it.
    let resourceId = '';
    let filePath = '';
    for (const res of received.items ?? []) {
      const entriesRes = await ctx.get(
        `/api/v1/public/share/resource/entries?resourceId=${encodeURIComponent(res.resourceId)}&path=`,
      );
      if (entriesRes.status() !== 200) continue;
      const entries = (await entriesRes.json()) as {
        items: Array<{ path: string; isDir: boolean }>;
      };
      const file = (entries.items ?? []).find((e) => !e.isDir);
      if (file) {
        resourceId = res.resourceId;
        filePath = file.path;
        break;
      }
    }
    test.skip(
      !resourceId,
      'audience has no received resource containing a browsable file to re-share',
    );

    const create = await ctx.post('/api/v1/public/share/create-from-resource', {
      data: { resourceId, relativePath: filePath, mode: 'download', expiresValue: 1, expiresUnit: 'day' },
    });
    expect(create.status()).toBe(200);
    const share = (await create.json()) as { token: string; url: string; name: string };
    expect(share.token).toBeTruthy();
    expect(share.url).toContain(share.token);
  } finally {
    await ctx.dispose();
  }
});

test("【定向分享(给指定用户) / API】 WH-API-053 受众列表 audiences", async () => {
  test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
  test.skip(!hasOwnerCredential(), 'no warehouse owner credential configured');
  test.skip(!targetKey(), 'WAREHOUSE_WALLET_PRIVATE_KEY (target audience) not configured');

  const stamp = Date.now();
  const ownerToken = (await acquireToken(apiBase()!)).token;
  const target = await loginWithWallet(apiBase()!, targetKey()!);
  const path = await putOwnedFile(apiBase()!, ownerToken, `e2e-aud-${stamp}.txt`, `aud-${stamp}`);
  const share = await createDirectedShare(apiBase()!, ownerToken, {
    path,
    targetAddresses: [target.address],
    permissions: ['read'],
    expiresValue: 1,
    expiresUnit: 'day',
  });

  const ctx = await authedRequest(apiBase()!, ownerToken);
  try {
    const res = await ctx.get(
      `/api/v1/public/share/user/audiences?shareId=${encodeURIComponent(share.id)}`,
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ type?: string; targetWallet?: string }>;
    };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    const wallets = body.items.map((i) => (i.targetWallet ?? '').toLowerCase());
    expect(wallets).toContain(target.address.toLowerCase());
  } finally {
    await revokeDirectedShare(apiBase()!, ownerToken, share.id).catch(() => undefined);
    await ctx.dispose();
  }
});
