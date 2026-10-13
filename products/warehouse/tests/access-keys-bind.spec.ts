/**
 * warehouse — AccessKey bind appends a binding path (WH-API-031).
 *
 * A WebDAV AccessKey is scoped to its bindingPaths. POST
 * /webdav/access-keys/bind {id, path} appends a new path to that scope. We
 * prove the scope actually widened end-to-end:
 *
 *   1. MKCOL a fresh directory at the owner's root.
 *   2. Create an AccessKey bound to /personal only.
 *   3. PROPFIND the new dir with the key → 403 (out of scope).
 *   4. bind the key to the new dir path.
 *   5. list shows bindingPaths now includes the new path.
 *   6. PROPFIND the new dir with the key → 207 (now in scope and reachable).
 *
 * Requires WAREHOUSE_WEBDAV_URL + WAREHOUSE_USER/PASS (Basic for MKCOL and
 * password login for the management API).
 *
 * Source: access_key handler HandleBind ({message:"bound successfully"},
 * appends to binding_paths); webdav auth rejects out-of-scope paths with 403.
 */
import { test, expect, envFor } from '../fixtures';
import {
  apiContext,
  applyAuth,
  webdavPropfind,
  expectStatus,
  type Auth,
} from '../../../shared/api';
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

interface CreateAccessKeyResponse {
  id: string;
  keyId: string;
  keySecret: string;
  bindingPaths?: string[];
}
interface ListAccessKeyResponse {
  items: Array<{ id: string; bindingPaths?: string[] }>;
}

test("【WebDAV 目录访问密钥(AccessKey) / API】 WH-API-031 bind 为 AccessKey 追加绑定路径", async () => {
  test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
  test.skip(!hasBasic(), 'WAREHOUSE_USER/PASS required');

  const stamp = Date.now();
  const dir = `/e2e-bindtarget-${stamp}`;
  const dav = await apiContext(apiBase()!, applyAuth({}, basicAuth()));
  const jwt = await authedRequest(apiBase()!, (await loginWithPassword(apiBase()!)).token);
  let keyId = '';
  try {
    // 1) fresh directory at the owner root
    const mkcol = await dav.fetch(`${prefix()}${dir}/`, { method: 'MKCOL' });
    expect(mkcol.status()).toBe(201);

    // 2) AccessKey bound to /personal only
    const createRes = await jwt.post('/api/v1/public/webdav/access-keys/create', {
      data: { name: `e2e-bind-${stamp}`, rootPath: '/personal', permissions: ['read'] },
    });
    expect(createRes.status()).toBe(200);
    const key = (await createRes.json()) as CreateAccessKeyResponse;
    keyId = key.id;
    const keyAuth: Auth = { type: 'basic', username: key.keyId, password: key.keySecret };

    // 3) out of scope → 403
    const before = await webdavPropfind({
      baseURL: apiBase()!,
      prefix: prefix(),
      path: dir,
      auth: keyAuth,
      depth: 1,
    });
    expect(before.status()).toBe(403);

    // 4) bind the new path
    const bind = await jwt.post('/api/v1/public/webdav/access-keys/bind', {
      data: { id: key.id, path: dir },
    });
    expect(bind.status()).toBe(200);

    // 5) the binding is recorded
    const listRes = await jwt.get('/api/v1/public/webdav/access-keys/list');
    expect(listRes.status()).toBe(200);
    const list = (await listRes.json()) as ListAccessKeyResponse;
    const listed = list.items.find((k) => k.id === key.id);
    expect(listed?.bindingPaths).toContain(dir);

    // 6) now in scope and reachable → 207
    const after = await webdavPropfind({
      baseURL: apiBase()!,
      prefix: prefix(),
      path: dir,
      auth: keyAuth,
      depth: 1,
    });
    expectStatus(after, 207);
  } finally {
    if (keyId) {
      await jwt
        .post('/api/v1/public/webdav/access-keys/delete', { data: { id: keyId } })
        .catch(() => undefined);
    }
    await dav.fetch(`${prefix()}${dir}/`, { method: 'DELETE' }).catch(() => undefined);
    await jwt.dispose();
    await dav.dispose();
  }
});
