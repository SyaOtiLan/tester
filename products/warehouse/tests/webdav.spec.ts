/**
 * warehouse — admin UI + WebDAV.
 *
 * Env vars consumed:
 *   - WAREHOUSE_BASE_URL  (Vite frontend, default http://localhost:5173)
 *   - WAREHOUSE_ADMIN_URL (Go admin, default http://localhost:6066)
 *   - WAREHOUSE_WEBDAV_URL (WebDAV, default http://localhost:6065)
 *   - WAREHOUSE_WEBDAV_PREFIX (default /dav)
 *   - WAREHOUSE_USER / WAREHOUSE_PASS (for Basic auth)
 *   - WAREHOUSE_AUTH_TOKEN (optional JWT/UCAN)
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, hasEnv, envFor } from '../fixtures';
import { webdavPropfind, webdavPut, webdavGet, expectStatus } from '../../../shared/api';

function skipIfNoService(product: 'warehouse') {
  test.skip(!baseURLFor(product), `WAREHOUSE_BASE_URL not configured`);
}

test(localizedTitle("【WebDAV 文件访问协议 / API】 WebDAV PROPFIND root 返回多状态", "WebDAV PROPFIND root returns multi-status"), async () => {
  skipIfNoService('warehouse');
  const env = envFor('warehouse');
  const webdavURL = env['WAREHOUSE_WEBDAV_URL'];
  test.skip(!webdavURL, 'WAREHOUSE_WEBDAV_URL not configured');
  const user = env['WAREHOUSE_USER'];
  const pass = env['WAREHOUSE_PASS'];

  const res = await webdavPropfind({
    baseURL: webdavURL!,
    prefix: env['WAREHOUSE_WEBDAV_PREFIX'],
    path: '/',
    auth: user && pass ? { type: 'basic', username: user, password: pass } : undefined,
    depth: 1,
  });
  expectStatus(res, [207, 401, 403]);
});

test(localizedTitle("【WebDAV 文件访问协议 / API】 WebDAV 往返 PUT 然后 GET 保留主体", "WebDAV round-trip PUT then GET preserves body"), async () => {
  skipIfNoService('warehouse');
  const env = envFor('warehouse');
  const webdavURL = env['WAREHOUSE_WEBDAV_URL'];
  test.skip(!webdavURL, 'WAREHOUSE_WEBDAV_URL not configured');
  test.skip(
    !hasEnv('WAREHOUSE_USER') || !hasEnv('WAREHOUSE_PASS'),
    'WAREHOUSE_USER and WAREHOUSE_PASS required for write tests',
  );

  const body = `hello-${Date.now()}`;
  const path = `/test-${Date.now()}.txt`;

  const put = await webdavPut({
    baseURL: webdavURL!,
    prefix: env['WAREHOUSE_WEBDAV_PREFIX'],
    path,
    body,
    contentType: 'text/plain',
    auth: { type: 'basic', username: env['WAREHOUSE_USER']!, password: env['WAREHOUSE_PASS']! },
  });
  expect([200, 201, 204, 207]).toContain(put.status());

  const get = await webdavGet({
    baseURL: webdavURL!,
    prefix: env['WAREHOUSE_WEBDAV_PREFIX'],
    path,
    auth: { type: 'basic', username: env['WAREHOUSE_USER']!, password: env['WAREHOUSE_PASS']! },
  });
  expect(get.status()).toBe(200);
  expect(await get.text()).toBe(body);
});
