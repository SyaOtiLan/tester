/**
 * warehouse — WebDAV protocol edges (WH-API-020, WH-API-021, WH-API-024).
 *
 *   - WH-API-020 COPY: PUT a source file, COPY it to a new path (201); both the
 *     source and the copy exist with identical bytes.
 *   - WH-API-021 OPTIONS: OPTIONS /dav/ advertises the supported verbs in the
 *     `Allow` header (GET/PUT/DELETE/PROPFIND/MKCOL/COPY/MOVE/LOCK …) and a
 *     `DAV` capability header.
 *   - WH-API-024 GET missing: GET of a non-existent path returns 404.
 *
 * All under HTTP Basic auth (WAREHOUSE_USER / WAREHOUSE_PASS) against the
 * WebDAV server on 6065, writing to the caller's own root collection.
 *
 * Source: golang.org/x/net/webdav (COPY→201, OPTIONS advertises Allow + DAV,
 * GET missing→404); webdav_service.go wiring.
 */
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

test.describe("【WebDAV 文件访问协议】WebDAV 协议边缘（WebDAV protocol edges）", () => {
  test("【WebDAV 文件访问协议 / API】 WH-API-020 COPY 复制文件", async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!hasBasic(), 'WAREHOUSE_USER/PASS required');

    const stamp = Date.now();
    const body = `copy-me-${stamp}`;
    const src = `${prefix()}/e2e-copy-src-${stamp}.txt`;
    const dst = `${prefix()}/e2e-copy-dst-${stamp}.txt`;
    const ctx = await davContext();
    try {
      const put = await ctx.fetch(src, { method: 'PUT', data: body });
      expect([200, 201, 204]).toContain(put.status());

      // Destination must be an absolute URL for the webdav COPY verb.
      const dstUrl = new URL(dst, apiBase()!).toString();
      const copy = await ctx.fetch(src, {
        method: 'COPY',
        headers: { Destination: dstUrl, Overwrite: 'T' },
      });
      expect([201, 204]).toContain(copy.status());

      // Both source and copy exist with the same bytes.
      const getSrc = await ctx.fetch(src, { method: 'GET' });
      expect(getSrc.status()).toBe(200);
      expect((await getSrc.text()).trim()).toBe(body);

      const getDst = await ctx.fetch(dst, { method: 'GET' });
      expect(getDst.status()).toBe(200);
      expect((await getDst.text()).trim()).toBe(body);
    } finally {
      const cleanup = await davContext();
      await cleanup.fetch(src, { method: 'DELETE' }).catch(() => undefined);
      await cleanup.fetch(dst, { method: 'DELETE' }).catch(() => undefined);
      await cleanup.dispose();
      await ctx.dispose();
    }
  });

  test("【WebDAV 文件访问协议 / API】 WH-API-021 OPTIONS 返回支持的方法与 DAV 头", async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!hasBasic(), 'WAREHOUSE_USER/PASS required');

    const ctx = await davContext();
    try {
      const res = await ctx.fetch(`${prefix()}/`, { method: 'OPTIONS' });
      expect([200, 204]).toContain(res.status());
      const headers = res.headers();
      const allow = headers['allow'] ?? '';
      for (const verb of ['GET', 'PUT', 'DELETE', 'PROPFIND', 'MKCOL', 'COPY', 'MOVE', 'LOCK']) {
        expect(allow, `Allow header should advertise ${verb}`).toContain(verb);
      }
      // DAV capability declaration (class 1/2).
      expect(headers['dav'], 'DAV capability header').toBeTruthy();
    } finally {
      await ctx.dispose();
    }
  });

  test("【WebDAV 文件访问协议 / API】 WH-API-024 GET 不存在文件返回 404", async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!hasBasic(), 'WAREHOUSE_USER/PASS required');

    const ctx = await davContext();
    try {
      const res = await ctx.fetch(`${prefix()}/e2e-does-not-exist-${Date.now()}.txt`, {
        method: 'GET',
      });
      expect(res.status()).toBe(404);
    } finally {
      await ctx.dispose();
    }
  });
});
