/**
 * warehouse — writable directed share lifecycle (WH-API-056).
 *
 * Owner (acquireToken) MKCOLs a directory and then directed-shares it to a
 * second user (the wallet identity) with full permissions [read, create,
 * update, delete]. The target exercises the full mutable-share workflow via
 * the JSON API:
 *
 *   POST   /share/user/folder  ? (shareId, path)        — create subfolder
 *   PUT    /share/user/upload  ? (shareId, path)        — upload file (multipart "file")
 *   GET    /share/user/download? (shareId, path)        — download file
 *   POST   /share/user/rename  ? (shareId, from, to)    — rename file
 *   DELETE /share/user/item    ? (shareId, path)        — delete file
 *
 * Requires:
 *   - WAREHOUSE_WEBDAV_URL          (backend API+WebDAV origin)
 *   - WAREHOUSE_WALLET_PRIVATE_KEY  (the target/audience user)
 *   - one working owner credential for acquireToken()
 *
 * Source: handler/share_user.go HandleUpload (multipart "file"), HandleCreateFolder
 * {shareId,path}, HandleDownload (?shareId=&path=), HandleRename {shareId,from,to},
 * HandleDelete {shareId,path}; router.go maps each path to its handler. The
 * rename handler does OS rename and so moves the file on disk.
 */
import { test, expect, envFor } from '../fixtures';
import { acquireToken, loginWithWallet, authedRequest } from '../helpers/auth';
import { createDirectedShare, revokeDirectedShare } from '../helpers/share';

function apiBase(): string | undefined {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_URL'];
}
function prefix(): string {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_PREFIX'] ?? '/dav';
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
function skipGuards() {
  test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
  test.skip(!hasOwnerCredential(), 'no warehouse owner credential configured');
  test.skip(!targetKey(), 'WAREHOUSE_WALLET_PRIVATE_KEY (target audience) not configured');
}

test.describe("【文件分享】可写定向共享生命周期（writable directed share lifecycle）", () => {
  test.describe.configure({ mode: 'serial' });
  const stamp = Date.now();
  const dirName = `e2e-dir-share-${stamp}`;
  let ownerToken = '';
  let targetToken = '';
  let targetAddress = '';
  let shareId = '';

  test.beforeAll(async () => {
    if (!apiBase() || !hasOwnerCredential() || !targetKey()) return;
    ownerToken = (await acquireToken(apiBase()!)).token;
    const target = await loginWithWallet(apiBase()!, targetKey()!);
    targetToken = target.token;
    targetAddress = target.address;

    // Owner creates the directory and directed-shares it with full perms.
    const ownerCtx = await authedRequest(apiBase()!, ownerToken);
    try {
      const mk = await ownerCtx.fetch(`${prefix()}/${dirName}`, { method: 'MKCOL' });
      expect([201, 200, 204, 301, 405]).toContain(mk.status()); // some impls return 405 with bodies
    } finally {
      await ownerCtx.dispose();
    }
    const share = await createDirectedShare(apiBase()!, ownerToken, {
      path: `/${dirName}`,
      targetAddresses: [targetAddress],
      permissions: ['read', 'create', 'update', 'delete'],
      expiresValue: 1,
      expiresUnit: 'day',
    });
    shareId = share.id;
  });

  test.afterAll(async () => {
    if (apiBase() && ownerToken && shareId) {
      await revokeDirectedShare(apiBase()!, ownerToken, shareId).catch(() => undefined);
    }
    // best-effort: clean the directory the owner created
    if (apiBase() && ownerToken) {
      const ctx = await authedRequest(apiBase()!, ownerToken);
      try {
        await ctx.fetch(`${prefix()}/${dirName}`, { method: 'DELETE' }).catch(() => undefined);
      } finally {
        await ctx.dispose();
      }
    }
  });

  test("【定向分享(给指定用户) / API】 WH-API-056 可写定向分享的下载/上传/新建/重命名/删除", async () => {
    skipGuards();

    const target = await authedRequest(apiBase()!, targetToken);
    try {
      // 1. create a subfolder
      const folderRes = await target.post('/api/v1/public/share/user/folder', {
        data: { shareId, path: `/${dirName}/sub-${stamp}` },
      });
      expect(folderRes.status()).toBe(200);

      // 2. upload a file inside the shared directory
      const uploadPath = `/${dirName}/sub-${stamp}/upload-${stamp}.txt`;
      const uploadRes = await target.fetch(`/api/v1/public/share/user/upload?shareId=${encodeURIComponent(shareId)}&path=${encodeURIComponent(uploadPath)}`, {
        method: 'PUT',
        multipart: {
          file: {
            name: `upload-${stamp}.txt`,
            mimeType: 'text/plain',
            buffer: Buffer.from(`uploaded-${stamp}`),
          },
        },
      });
      expect(uploadRes.status()).toBe(200);

      // 3. download it back
      const downloadRes = await target.get(
        `/api/v1/public/share/user/download?shareId=${encodeURIComponent(shareId)}&path=${encodeURIComponent(uploadPath)}`,
      );
      expect(downloadRes.status()).toBe(200);
      const downloaded = (await downloadRes.text()).trim();
      expect(downloaded).toBe(`uploaded-${stamp}`);

      // 4. rename the file in place
      const renamedPath = `/${dirName}/sub-${stamp}/renamed-${stamp}.txt`;
      const renameRes = await target.post('/api/v1/public/share/user/rename', {
        data: { shareId, from: uploadPath, to: renamedPath },
      });
      expect(renameRes.status()).toBe(200);

      // 5. delete the renamed file
      const delRes = await target.fetch('/api/v1/public/share/user/item', {
        method: 'DELETE',
        data: { shareId, path: renamedPath },
      });
      expect(delRes.status()).toBe(200);
    } finally {
      await target.dispose();
    }
  });
});
