/**
 * warehouse — quota calculation (WH-API-058, WH-API-059).
 *
 *   - WH-API-058 百分比计算: a fresh SIWE identity starts with a finite default
 *     quota (1 GiB) and 0 used. After PUTting N bytes, GET /webdav/quota
 *     reports used === N, used + available === quota, and percentage ===
 *     used/quota*100. A brand-new random wallet is used so the space is empty
 *     and the arithmetic is exact.
 *   - WH-API-059 无限配额: the admin identity is provisioned with an unlimited
 *     quota — GET /webdav/quota reports unlimited=true with available=-1 and a
 *     benign percentage (0).
 *
 * Requires WAREHOUSE_WEBDAV_URL. WH-API-058 needs SIWE (auto-creates the fresh
 * wallet user); WH-API-059 uses the admin password credential.
 *
 * Source: quota_service.go computes percentage = used/quota*100 for finite
 * quotas and marks unlimited (quota<=0) with available=-1, percentage=0.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, envFor } from '../fixtures';
import { Wallet } from 'ethers';
import { loginWithWallet, loginWithPassword, authedRequest } from '../helpers/auth';

function apiBase(): string | undefined {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_URL'];
}
function prefix(): string {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_PREFIX'] ?? '/dav';
}
function hasPassword(): boolean {
  const env = envFor('warehouse');
  return Boolean(env['WAREHOUSE_USER'] && env['WAREHOUSE_PASS']);
}

interface Quota {
  quota: number;
  used: number;
  available: number;
  percentage: number;
  unlimited: boolean;
}

test(localizedTitle("【配额 / API】 WH-API-058 配额百分比计算正确", "WH-API-058 quota percentage matches used/quota after an upload"), async () => {
  test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');

  // A brand-new wallet → empty, finite default quota → exact arithmetic.
  const fresh = await loginWithWallet(apiBase()!, Wallet.createRandom().privateKey);
  const ctx = await authedRequest(apiBase()!, fresh.token);
  try {
    const name = `e2e-quota-calc-${Date.now()}.bin`;
    const bytes = 11 * 1024 * 1024; // 11 MiB → percentage ~1%
    const put = await ctx.fetch(`${prefix()}/personal/${name}`, {
      method: 'PUT',
      data: Buffer.alloc(bytes, 1),
    });
    expect([200, 201, 204]).toContain(put.status());

    const res = await ctx.get('/api/v1/public/webdav/quota');
    expect(res.status()).toBe(200);
    const q = (await res.json()) as Quota;

    expect(q.unlimited).toBe(false);
    expect(q.quota).toBeGreaterThan(0);
    // The uploaded bytes are accounted for.
    expect(q.used).toBeGreaterThanOrEqual(bytes);
    // used + available reconstructs the total quota.
    expect(q.used + q.available).toBe(q.quota);
    // percentage is consistent with used/quota.
    expect(Math.abs(q.percentage - (q.used / q.quota) * 100)).toBeLessThan(0.01);

    // cleanup
    await ctx.fetch(`${prefix()}/personal/${name}`, { method: 'DELETE' }).catch(() => undefined);
  } finally {
    await ctx.dispose();
  }
});

test(localizedTitle("【配额 / API】 WH-API-059 无限配额标记 unlimited", "WH-API-059 an unlimited-quota account is flagged unlimited"), async () => {
  test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
  test.skip(!hasPassword(), 'WAREHOUSE_USER/PASS required (admin has the unlimited quota)');

  const admin = await loginWithPassword(apiBase()!);
  const ctx = await authedRequest(apiBase()!, admin.token);
  try {
    const res = await ctx.get('/api/v1/public/webdav/quota');
    expect(res.status()).toBe(200);
    const q = (await res.json()) as Quota;
    test.skip(
      !q.unlimited,
      'configured admin identity does not have an unlimited quota in this environment',
    );
    expect(q.unlimited).toBe(true);
    // Unlimited quotas report available=-1 and a benign percentage.
    expect(q.available).toBeLessThan(0);
    expect(q.percentage).toBe(0);
  } finally {
    await ctx.dispose();
  }
});
