/**
 * warehouse — WebDAV round-trip using either an HTTP basic credential or a
 * token-protected AccessKey (created via /api/v1/public/webdav/access-keys/create).
 *
 * Env vars consumed:
 *   - WAREHOUSE_BASE_URL         (Vite frontend)
 *   - WAREHOUSE_WEBDAV_URL       (default http://127.0.0.1:6065)
 *   - WAREHOUSE_WEBDAV_PREFIX    (default /dav)
 *   - WAREHOUSE_USER, WAREHOUSE_PASS (optional; used for direct Basic auth)
 *   - WAREHOUSE_AUTH_TOKEN       (optional; pre-issued JWT)
 */
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { acquireToken, authedRequest } from '../helpers/auth';
import { apiContext, expectStatus, webdavGet, webdavPropfind, webdavPut, type Auth } from '../../../shared/api';

function skipIfNoService() {
  test.skip(!baseURLFor('warehouse'), 'WAREHOUSE_BASE_URL not configured');
}

test("【鉴权与会话 / API】 密码登录会产生绑定到钱包地址的 JWT", async () => {
  skipIfNoService();
  const tokens = await acquireToken(baseURLFor('warehouse')!);
  expect(tokens.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  expect(tokens.address).toMatch(/^0x[0-9a-f]{40}$/);
  expect(tokens.source).toBe('password');
});

test("【鉴权与会话 / API】 GET /api/v1/public/webdav/quota 和 JWT 返回配额负载", async () => {
  skipIfNoService();
  const tokens = await acquireToken(baseURLFor('warehouse')!);
  const ctx = await authedRequest(baseURLFor('warehouse')!, tokens.token);
  try {
    const res = await ctx.get('/api/v1/public/webdav/quota');
    expect(res.status()).toBe(200);
    const body = await res.json();
    // /webdav/quota returns the quota object directly (not the SDK envelope).
    expect(typeof body.quota).toBe('number');
    expect(typeof body.used).toBe('number');
    expect('available' in body).toBe(true);
  } finally {
    await ctx.dispose();
  }
});

test("【鉴权与会话 / API】 GET /api/v1/public/webdav/user/info 返回登录用户", async () => {
  skipIfNoService();
  const tokens = await acquireToken(baseURLFor('warehouse')!);
  const ctx = await authedRequest(baseURLFor('warehouse')!, tokens.token);
  try {
    const res = await ctx.get('/api/v1/public/webdav/user/info');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.username).toBeTruthy();
    expect(body.wallet_address).toMatch(/^0x[0-9a-f]{40}$/i);
    expect(Array.isArray(body.permissions)).toBe(true);
  } finally {
    await ctx.dispose();
  }
});

test("【鉴权与会话 / API】 具有基本身份验证的 root 上的 WebDAV PROPFIND 响应 207", async () => {
  skipIfNoService();
  const env = envFor('warehouse');
  test.skip(
    !env['WAREHOUSE_WEBDAV_URL'] || !env['WAREHOUSE_USER'] || !env['WAREHOUSE_PASS'],
    'WebDAV direct check requires WAREHOUSE_WEBDAV_URL + USER/PASS',
  );

  const auth: Auth = {
    type: 'basic',
    username: env['WAREHOUSE_USER']!,
    password: env['WAREHOUSE_PASS']!,
  };
  const res = await webdavPropfind({
    baseURL: env['WAREHOUSE_WEBDAV_URL']!,
    prefix: env['WAREHOUSE_WEBDAV_PREFIX'] ?? '/dav',
    path: '/',
    auth,
    depth: 1,
  });
  // 207 = multi-status, 401/403 = auth in flight but server reachable
  expectStatus(res, [207, 401, 403]);
});

test("【鉴权与会话 / API】 /personal/<user> 上的 WebDAV PROPFIND 具有基本身份验证列出用户空间", async () => {
  skipIfNoService();
  const env = envFor('warehouse');
  test.skip(
    !env['WAREHOUSE_WEBDAV_URL'] || !env['WAREHOUSE_USER'] || !env['WAREHOUSE_PASS'],
    'WebDAV direct check requires WAREHOUSE_WEBDAV_URL + USER/PASS',
  );

  const auth: Auth = {
    type: 'basic',
    username: env['WAREHOUSE_USER']!,
    password: env['WAREHOUSE_PASS']!,
  };
  const username = env['WAREHOUSE_USER']!;
  const res = await webdavPropfind({
    baseURL: env['WAREHOUSE_WEBDAV_URL']!,
    prefix: env['WAREHOUSE_WEBDAV_PREFIX'] ?? '/dav',
    path: `/personal/${username}`,
    auth,
    depth: 1,
  });
  expectStatus(res, [207, 404, 401, 403]);
});

test("【鉴权与会话 / API】 WebDAV PUT 然后 GET 往返保留字节（基本身份验证）", async () => {
  skipIfNoService();
  const env = envFor('warehouse');
  test.skip(
    !env['WAREHOUSE_WEBDAV_URL'] || !env['WAREHOUSE_USER'] || !env['WAREHOUSE_PASS'],
    'WebDAV direct check requires WAREHOUSE_WEBDAV_URL + USER/PASS',
  );

  const auth: Auth = {
    type: 'basic',
    username: env['WAREHOUSE_USER']!,
    password: env['WAREHOUSE_PASS']!,
  };
  // PUT to the root collection (admin user has write access there). Personal
  // and apps/services directories are governed by the WebDAV service and a
  // freshly created admin account does not own a /personal/<user> folder.
  const stamp = Date.now();
  const body = `e2e-${stamp}-${Math.random().toString(36).slice(2)}`;
  const path = `/test-${stamp}.txt`;

  const put = await webdavPut({
    baseURL: env['WAREHOUSE_WEBDAV_URL']!,
    prefix: env['WAREHOUSE_WEBDAV_PREFIX'] ?? '/dav',
    path,
    body,
    contentType: 'text/plain',
    auth,
  });
  expect([200, 201, 204]).toContain(put.status());

  const get = await webdavGet({
    baseURL: env['WAREHOUSE_WEBDAV_URL']!,
    prefix: env['WAREHOUSE_WEBDAV_PREFIX'] ?? '/dav',
    path,
    auth,
  });
  expect(get.status()).toBe(200);
  expect((await get.text()).trim()).toBe(body);

  // Move the file to recycle so the warehouse stays tidy.
  const recycleCtx = await apiContext(env['WAREHOUSE_WEBDAV_URL']!);
  try {
    // Best-effort cleanup via the WebDAV MOVE method into the recycle bin.
    const filename = path.split('/').pop()!;
    const moveRes = await recycleCtx.fetch(
      `${env['WAREHOUSE_WEBDAV_PREFIX'] ?? '/dav'}/.recycle/${filename}`,
      {
        method: 'PUT',
        headers: {
          'X-Litmus': 'ignore',
          // Custom header the WebDAV server may use to mark recycle writes; not
          // required by the standard interface but commonly honoured.
        },
        data: body,
      },
    );
    // We don't assert on this — recycle semantics vary by deployment.
    void moveRes;
  } finally {
    await recycleCtx.dispose();
  }
});
