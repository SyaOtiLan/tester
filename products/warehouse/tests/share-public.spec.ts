/**
 * warehouse — public share create + anonymous access (WH-API-043, WH-API-045).
 *
 * Owner (via acquireToken) PUTs a file to their WebDAV root, creates a public
 * share, then confirms the share is reachable anonymously (no auth): the bare
 * token URL 302-redirects to the file URL, and the file URL returns the exact
 * bytes.
 *
 * Requires:
 *   - WAREHOUSE_WEBDAV_URL   (backend API+WebDAV origin, e.g. http://localhost:6065)
 *   - one working credential for acquireToken() (WAREHOUSE_USER+PASS / AUTH_TOKEN / WALLET_PRIVATE_KEY)
 *
 * Verified source behavior (handler/share.go):
 *   - POST /api/v1/public/share/create → top-level { token, url, name, expiresAt, ... }
 *     (NOT the {code,message,data} envelope). mode "download"|"preview",
 *     expiresUnit singular (day/hour/...).
 *   - GET /api/v1/public/share/<token>            → 302 Location: <url-with-filename>
 *   - GET /api/v1/public/share/<token>/<filename> → 200 file bytes
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, envFor } from '../fixtures';
import { acquireToken } from '../helpers/auth';
import {
  createPublicShare,
  putOwnedFile,
  revokePublicShare,
  type PublicShare,
} from '../helpers/share';
import { apiContext } from '../../../shared/api';

function apiBase(): string | undefined {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_URL'];
}
function hasCredential(): boolean {
  const env = envFor('warehouse');
  return Boolean(
    env['WAREHOUSE_AUTH_TOKEN'] ||
      (env['WAREHOUSE_USER'] && env['WAREHOUSE_PASS']) ||
      env['WAREHOUSE_WALLET_PRIVATE_KEY'],
  );
}

test.describe(localizedTitle("【文件分享】public share（public share）", "public share"), () => {
  test.describe.configure({ mode: 'serial' });
  let token = '';
  let share: PublicShare | null = null;
  const stamp = Date.now();
  const fileName = `e2e-public-share-${stamp}.txt`;
  const content = `public-share-content-${stamp}`;

  test.afterAll(async () => {
    if (!apiBase() || !token || !share) return;
    await revokePublicShare(apiBase()!, token, share.token);
  });

  test(localizedTitle("【公开分享 / API】 WH-API-043 创建公开分享返回可访问链接", "WH-API-043 create public share returns an accessible link"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!hasCredential(), 'no warehouse credential configured');

    token = (await acquireToken(apiBase()!)).token;
    const path = await putOwnedFile(apiBase()!, token, fileName, content);

    share = await createPublicShare(apiBase()!, token, path, {
      mode: 'download',
      expiresValue: 1,
      expiresUnit: 'day',
    });

    expect(share.token).toMatch(/^[0-9a-f-]{16,}$/);
    expect(share.url).toContain(`/api/v1/public/share/${share.token}`);
    expect(share.expiresAt, 'a bounded share must report expiresAt').toBeTruthy();
  });

  test(localizedTitle("【公开分享 / API】 WH-API-045 通过分享链接匿名访问", "WH-API-045 anonymous access via the share link works"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!share, 'previous test did not create a share');

    // Anonymous context — no Authorization header at all.
    const anon = await apiContext(apiBase()!);
    try {
      // 1) bare token URL 302-redirects to the file URL (do not auto-follow)
      const redirect = await anon.get(`/api/v1/public/share/${share!.token}`, {
        maxRedirects: 0,
      });
      expect(redirect.status()).toBe(302);
      const location = redirect.headers()['location'];
      expect(location).toContain(`/api/v1/public/share/${share!.token}/`);

      // 2) the file URL returns the exact bytes we shared
      const fileRes = await anon.get(location!);
      expect(fileRes.status()).toBe(200);
      expect(await fileRes.text()).toBe(content);
    } finally {
      await anon.dispose();
    }
  });
});
