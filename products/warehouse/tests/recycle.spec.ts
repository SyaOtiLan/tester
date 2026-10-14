/**
 * warehouse — recycle bin lifecycle (WH-API-039, WH-API-040, WH-API-041).
 *
 * A WebDAV DELETE moves the target into the per-user recycle bin (returns 200).
 * The recycle bin is then managed through the JWT-authenticated management API.
 *
 *   - WH-API-039: after deleting a file it appears in GET /recycle/list.
 *   - WH-API-040: POST /recycle/recover {hash} restores it to its original path.
 *   - WH-API-041: DELETE /recycle/permanent {hash} removes it for good.
 *
 * The same admin identity authenticates both WebDAV (Basic) and the management
 * API (JWT), so the recycle records created by DELETE are visible to /list.
 *
 * Requires:
 *   - WAREHOUSE_WEBDAV_URL (backend API+WebDAV origin, e.g. http://localhost:6065)
 *   - WAREHOUSE_USER + WAREHOUSE_PASS (Basic auth + password login)
 *
 * Source: webdav_service.handleDeleteWithRecycle → moveToRecycle; recycle.go
 * HandleList {items:[{hash,name,path,...}]}, HandleRecover {hash},
 * HandleRemove (permanent, DELETE {hash}).
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

interface RecycleItem {
  hash: string;
  name: string;
  path: string;
  isDir: boolean;
}
interface RecycleList {
  items: RecycleItem[];
}

async function davContext() {
  return apiContext(apiBase()!, applyAuth({}, basicAuth()));
}
async function jwtContext() {
  const token = await loginWithPassword(apiBase()!);
  return authedRequest(apiBase()!, token.token);
}

/** PUT a file over WebDAV, then DELETE it (moving it to the recycle bin). */
async function putThenDelete(name: string, body: string): Promise<void> {
  const dav = await davContext();
  try {
    const put = await dav.fetch(`${prefix()}/${name}`, { method: 'PUT', data: body });
    expect([200, 201, 204]).toContain(put.status());
    const del = await dav.fetch(`${prefix()}/${name}`, { method: 'DELETE' });
    expect([200, 204]).toContain(del.status());
  } finally {
    await dav.dispose();
  }
}

async function findByName(name: string): Promise<RecycleItem | undefined> {
  const jwt = await jwtContext();
  try {
    const res = await jwt.get('/api/v1/public/webdav/recycle/list?page=1&page_size=200');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as RecycleList;
    return body.items.find((i) => i.name === name);
  } finally {
    await jwt.dispose();
  }
}

test.describe(localizedTitle("【回收站】回收站（recycle bin）", "recycle bin"), () => {
  test(localizedTitle("【回收站 / API】 WH-API-039 删除文件进入回收站列表", "WH-API-039 a deleted file appears in the recycle list"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!hasBasic(), 'WAREHOUSE_USER/PASS required');

    const name = `e2e-recycle-list-${Date.now()}.txt`;
    await putThenDelete(name, `recycle-me-${name}`);

    const item = await findByName(name);
    expect(item, `recycle item for ${name}`).toBeTruthy();
    expect(item!.hash).toBeTruthy();

    // cleanup: permanently remove it
    const jwt = await jwtContext();
    try {
      await jwt.fetch('/api/v1/public/webdav/recycle/permanent', {
        method: 'DELETE',
        data: { hash: item!.hash },
      });
    } finally {
      await jwt.dispose();
    }
  });

  test(localizedTitle("【回收站 / API】 WH-API-040 从回收站恢复文件", "WH-API-040 recover restores a deleted file to its original path"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!hasBasic(), 'WAREHOUSE_USER/PASS required');

    const name = `e2e-recycle-recover-${Date.now()}.txt`;
    const body = `recover-me-${name}`;
    await putThenDelete(name, body);

    const item = await findByName(name);
    expect(item, `recycle item for ${name}`).toBeTruthy();

    const jwt = await jwtContext();
    try {
      const recover = await jwt.post('/api/v1/public/webdav/recycle/recover', {
        data: { hash: item!.hash },
      });
      expect(recover.status()).toBe(200);
    } finally {
      await jwt.dispose();
    }

    // The file is back at its original WebDAV path with the original bytes.
    const dav = await davContext();
    try {
      const get = await dav.fetch(`${prefix()}/${name}`, { method: 'GET' });
      expect(get.status()).toBe(200);
      expect((await get.text()).trim()).toBe(body);
      // cleanup
      await dav.fetch(`${prefix()}/${name}`, { method: 'DELETE' }).catch(() => undefined);
    } finally {
      await dav.dispose();
    }
    // cleanup the recycle entry produced by the final delete
    const leftover = await findByName(name);
    if (leftover) {
      const jwt2 = await jwtContext();
      try {
        await jwt2.fetch('/api/v1/public/webdav/recycle/permanent', {
          method: 'DELETE',
          data: { hash: leftover.hash },
        });
      } finally {
        await jwt2.dispose();
      }
    }
  });

  test(localizedTitle("【回收站 / API】 WH-API-041 永久删除单个回收站条目", "WH-API-041 permanent delete removes a recycle entry for good"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    test.skip(!hasBasic(), 'WAREHOUSE_USER/PASS required');

    const name = `e2e-recycle-permanent-${Date.now()}.txt`;
    await putThenDelete(name, `permanent-me-${name}`);

    const item = await findByName(name);
    expect(item, `recycle item for ${name}`).toBeTruthy();

    const jwt = await jwtContext();
    try {
      const remove = await jwt.fetch('/api/v1/public/webdav/recycle/permanent', {
        method: 'DELETE',
        data: { hash: item!.hash },
      });
      expect(remove.status()).toBe(200);
    } finally {
      await jwt.dispose();
    }

    // The entry is gone from the recycle list.
    const after = await findByName(name);
    expect(after, `recycle item for ${name} should be gone`).toBeFalsy();
  });
});
