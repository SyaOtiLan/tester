/**
 * warehouse — clear the recycle bin (WH-API-042).
 *
 * A WebDAV DELETE moves files into the per-user recycle bin. DELETE
 * /webdav/recycle/clear empties the whole bin; a subsequent /recycle/list is
 * empty.
 *
 *   1. PUT + DELETE two files (populate the recycle bin).
 *   2. GET /recycle/list → at least those two entries present.
 *   3. DELETE /recycle/clear → 200.
 *   4. GET /recycle/list → empty (total 0).
 *
 * Requires WAREHOUSE_WEBDAV_URL + WAREHOUSE_USER/PASS (Basic for the WebDAV
 * writes and password login for the management API). This intentionally
 * empties the caller's recycle bin — run against the throwaway admin identity.
 *
 * Source: recycle.go HandleClear (DELETE, wipes all entries for the user) and
 * HandleList ({items,total}).
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, envFor } from '../fixtures';
import { apiContext, applyAuth, type Auth } from '../../../shared/api';
import { loginWithPassword, authedRequest } from '../helpers/auth';

function apiBase(): string | undefined {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_URL'];
}
function prefix(): string {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_PREFIX'] ?? '/dav';
}
function basicAuth(): Auth | undefined {
  const env = envFor('warehouse');
  if (!env['WAREHOUSE_USER'] || !env['WAREHOUSE_PASS']) return undefined;
  return { type: 'basic', username: env['WAREHOUSE_USER']!, password: env['WAREHOUSE_PASS']! };
}
function hasBasic(): boolean {
  return Boolean(basicAuth());
}

interface RecycleList {
  items: Array<{ hash: string; name: string }>;
  total?: number;
}

test(localizedTitle("【回收站 / API】 WH-API-042 清空回收站", "WH-API-042 clearing the recycle bin empties the list"), async () => {
  test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
  test.skip(!hasBasic(), 'WAREHOUSE_USER/PASS required');

  const stamp = Date.now();
  const names = [`e2e-clear-a-${stamp}.txt`, `e2e-clear-b-${stamp}.txt`];
  const dav = await apiContext(apiBase()!, applyAuth({}, basicAuth()));
  const jwt = await authedRequest(apiBase()!, (await loginWithPassword(apiBase()!)).token);
  try {
    // 1) populate the recycle bin
    for (const name of names) {
      const put = await dav.fetch(`${prefix()}/${name}`, { method: 'PUT', data: `clear-${name}` });
      expect([200, 201, 204]).toContain(put.status());
      const del = await dav.fetch(`${prefix()}/${name}`, { method: 'DELETE' });
      expect([200, 204]).toContain(del.status());
    }

    // 2) both entries are present
    const listed = await jwt.get('/api/v1/public/webdav/recycle/list?page=1&page_size=200');
    expect(listed.status()).toBe(200);
    const before = (await listed.json()) as RecycleList;
    for (const name of names) {
      expect(before.items.find((i) => i.name === name), `recycle entry ${name}`).toBeTruthy();
    }

    // 3) clear
    const clear = await jwt.fetch('/api/v1/public/webdav/recycle/clear', { method: 'DELETE' });
    expect(clear.status()).toBe(200);

    // 4) the bin is empty
    const afterRes = await jwt.get('/api/v1/public/webdav/recycle/list?page=1&page_size=200');
    expect(afterRes.status()).toBe(200);
    const after = (await afterRes.json()) as RecycleList;
    expect(after.items.length).toBe(0);
  } finally {
    await jwt.dispose();
    await dav.dispose();
  }
});
