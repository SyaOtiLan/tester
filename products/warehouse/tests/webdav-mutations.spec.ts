/**
 * warehouse — WebDAV mutation verbs (WH-API-017, WH-API-018, WH-API-019, WH-API-023).
 *
 * All exercise the WebDAV server on the API port (6065) under HTTP Basic auth
 * (WAREHOUSE_USER / WAREHOUSE_PASS). Paths resolve relative to the caller's own
 * space, so the admin account can freely write to its root collection.
 *
 *   - WH-API-017 DELETE a file, then GET it → 404
 *   - WH-API-018 MKCOL creates a directory (201) that then appears in PROPFIND
 *   - WH-API-019 MOVE renames a file (201/204); target has the bytes, source 404
 *   - WH-API-023 PUT into another user's /personal/<user> space → 403
 *
 * Requires:
 *   - WAREHOUSE_WEBDAV_URL (backend API+WebDAV origin, e.g. http://localhost:6065)
 *   - WAREHOUSE_USER + WAREHOUSE_PASS (Basic auth)
 *
 * Source: webdav_service.go maps unauthorized/permission failures to 403 and
 * uses golang.org/x/net/webdav for the actual verbs (MKCOL→201, DELETE→204,
 * MOVE→201/204).
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, envFor } from '../fixtures';
import { apiContext, applyAuth, type Auth } from '../../../shared/api';

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

async function davContext() {
  return apiContext(apiBase()!, applyAuth({}, basicAuth()));
}

test.describe(localizedTitle("【WebDAV 文件访问协议】WebDAV 突变动词（WebDAV mutation verbs）", "WebDAV mutation verbs"), () => {
  test(localizedTitle("【WebDAV 文件访问协议 / API】 WH-API-017 DELETE 文件后再 GET 返回 404", "WH-API-017 DELETE a file, then GET returns 404"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!hasBasic(), 'WAREHOUSE_USER/PASS required');

    const stamp = Date.now();
    const body = `delete-me-${stamp}`;
    const path = `${prefix()}/e2e-del-${stamp}.txt`;
    const ctx = await davContext();
    try {
      const put = await ctx.fetch(path, { method: 'PUT', data: body });
      expect([200, 201, 204]).toContain(put.status());

      const del = await ctx.fetch(path, { method: 'DELETE' });
      expect([200, 204]).toContain(del.status());

      const get = await ctx.fetch(path, { method: 'GET' });
      expect(get.status()).toBe(404);
    } finally {
      await ctx.dispose();
    }
  });

  test(localizedTitle("【WebDAV 文件访问协议 / API】 WH-API-018 MKCOL 创建目录", "WH-API-018 MKCOL creates a directory that appears in PROPFIND"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!hasBasic(), 'WAREHOUSE_USER/PASS required');

    const stamp = Date.now();
    const dir = `e2e-dir-${stamp}`;
    const dirPath = `${prefix()}/${dir}/`;
    const ctx = await davContext();
    try {
      const mkcol = await ctx.fetch(dirPath, { method: 'MKCOL' });
      expect(mkcol.status()).toBe(201);

      // PROPFIND the parent collection and confirm the new dir is listed.
      const propfind = await ctx.fetch(`${prefix()}/`, {
        method: 'PROPFIND',
        headers: { Depth: '1', 'Content-Type': 'application/xml' },
        data: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>',
      });
      expect(propfind.status()).toBe(207);
      expect(await propfind.text()).toContain(dir);
    } finally {
      // best-effort cleanup
      const cleanup = await davContext();
      await cleanup.fetch(dirPath, { method: 'DELETE' }).catch(() => undefined);
      await cleanup.dispose();
      await ctx.dispose();
    }
  });

  test(localizedTitle("【WebDAV 文件访问协议 / API】 WH-API-019 MOVE 重命名/移动文件", "WH-API-019 MOVE renames a file; target has the bytes, source is gone"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!hasBasic(), 'WAREHOUSE_USER/PASS required');

    const stamp = Date.now();
    const body = `move-me-${stamp}`;
    const src = `${prefix()}/e2e-move-a-${stamp}.txt`;
    const dstName = `e2e-move-b-${stamp}.txt`;
    const dst = `${prefix()}/${dstName}`;
    const ctx = await davContext();
    try {
      const put = await ctx.fetch(src, { method: 'PUT', data: body });
      expect([200, 201, 204]).toContain(put.status());

      const move = await ctx.fetch(src, {
        method: 'MOVE',
        headers: { Destination: dst, Overwrite: 'T' },
      });
      expect([201, 204]).toContain(move.status());

      const getDst = await ctx.fetch(dst, { method: 'GET' });
      expect(getDst.status()).toBe(200);
      expect((await getDst.text()).trim()).toBe(body);

      const getSrc = await ctx.fetch(src, { method: 'GET' });
      expect(getSrc.status()).toBe(404);
    } finally {
      const cleanup = await davContext();
      await cleanup.fetch(dst, { method: 'DELETE' }).catch(() => undefined);
      await cleanup.dispose();
      await ctx.dispose();
    }
  });

  test(localizedTitle("【WebDAV 文件访问协议 / API】 WH-API-023 PUT 到他人个人空间返回 403", "WH-API-023 PUT into another user's /personal space is forbidden (403)"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!hasBasic(), 'WAREHOUSE_USER/PASS required');

    // A /personal/<other> subtree the admin account neither owns nor has a rule
    // granting write to. The WebDAV permission check rejects the write with 403.
    const stamp = Date.now();
    const path = `${prefix()}/personal/e2e-other-user-${stamp}/blocked-${stamp}.txt`;
    const ctx = await davContext();
    try {
      const put = await ctx.fetch(path, { method: 'PUT', data: 'should-be-denied' });
      expect(put.status()).toBe(403);
    } finally {
      await ctx.dispose();
    }
  });
});
