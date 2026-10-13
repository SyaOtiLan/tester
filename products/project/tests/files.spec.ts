/**
 * project — file cabinet (P1 API).
 *
 * Covers PJ-095, PJ-096, PJ-097, PJ-098, PJ-101.
 * (PJ-102 upload/download via the file page is an E2E case; see project-ui-p1.spec.ts.)
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
import { createHash } from 'node:crypto';
import { request } from '@playwright/test';
import { test, expect, baseURLFor } from '../fixtures';
import { registerUser, apiGet, apiPost, type RegisteredUser } from '../helpers/api';

const baseURL = baseURLFor('project');

test.describe("【文件管理(文件柜)】项目文件柜（P1 API）（project file cabinet (P1 API)）", () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  let user: RegisteredUser;
  test.beforeAll(async () => {
    if (!baseURL) return;
    user = await registerUser(baseURL);
  });

  // PJ-095 获取文件列表
  test("【文件管理(文件柜) / API】 PJ-095 获取文件列表", async () => {
    const body = await apiGet(baseURL!, '/api/file/lists?pid=0', user.token);
    expect(body.ret).toBe(1);
    expect(Array.isArray(body.data)).toBe(true);
  });

  // PJ-096 新建文件/文件夹
  test("【文件管理(文件柜) / API】 PJ-096 新建文件/文件夹", async () => {
    const name = `夹${Date.now() % 100000}`;
    const body = await apiPost(baseURL!, '/api/file/add', { name, type: 'folder', pid: 0 }, user.token);
    expect(body.ret).toBe(1);
    expect(body.msg).toBe('添加成功');
    expect(body.data.name).toBe(name);
    expect(body.data.type).toBe('folder');
  });

  // PJ-097 复制/移动文件
  test("【文件管理(文件柜) / API】 PJ-097 复制/移动文件", async () => {
    const doc = await apiPost(baseURL!, '/api/file/add', { name: `文档${Date.now() % 100000}`, type: 'document', pid: 0 }, user.token);
    expect(doc.ret).toBe(1);
    const docId = Number(doc.data.id);

    const copy = await apiPost(baseURL!, '/api/file/copy', { id: docId }, user.token);
    expect(copy.ret).toBe(1);
    expect(copy.msg).toBe('复制成功');

    const folder = await apiPost(baseURL!, '/api/file/add', { name: `目标夹${Date.now() % 100000}`, type: 'folder', pid: 0 }, user.token);
    expect(folder.ret).toBe(1);
    const folderId = Number(folder.data.id);

    const move = await apiPost(baseURL!, '/api/file/move', { ids: [docId], pid: folderId }, user.token);
    expect(move.ret).toBe(1);
    expect(move.msg).toBe('操作成功');
  });

  // PJ-098 删除文件
  test("【文件管理(文件柜) / API】 PJ-098 删除文件", async () => {
    const folder = await apiPost(baseURL!, '/api/file/add', { name: `待删夹${Date.now() % 100000}`, type: 'folder', pid: 0 }, user.token);
    expect(folder.ret).toBe(1);
    const id = Number(folder.data.id);

    const body = await apiPost(baseURL!, '/api/file/remove', { ids: [id] }, user.token);
    expect(body.ret).toBe(1);
    expect(body.msg).toBe('删除成功');
  });

  // PJ-101 分片上传 init/chunk/merge
  test("【文件管理(文件柜) / API】 PJ-101 分片上传 init/chunk/merge", async () => {
    const content = Buffer.from(`e2e upload ${Date.now()}`);
    const hash = createHash('md5').update(content).digest('hex');

    const init = await apiPost(
      baseURL!,
      '/api/upload/init',
      { hash, size: content.length, name: 'e2e-upload.txt', scene: 'file_cabinet', scene_params: { pid: 0 } },
      user.token,
    );
    expect(init.ret).toBe(1);
    const uploadId: string = init.data.upload_id;
    expect(typeof uploadId).toBe('string');

    // Chunk upload requires a multipart body carrying the blob.
    const ctx = await request.newContext({ baseURL: baseURL!, extraHTTPHeaders: { token: user.token } });
    try {
      const chunkRes = await ctx.post('/api/upload/chunk', {
        multipart: {
          upload_id: uploadId,
          index: 0,
          blob: { name: 'e2e-upload.txt', mimeType: 'text/plain', buffer: content },
        },
      });
      const chunk = await chunkRes.json();
      expect(chunk.ret).toBe(1);
      expect(chunk.data.received).toContain(0);
    } finally {
      await ctx.dispose();
    }

    const merge = await apiPost(baseURL!, '/api/upload/merge', { upload_id: uploadId }, user.token);
    expect(merge.ret).toBe(1);
    // merge returns the ingested file record(s).
    expect(merge.data).toBeTruthy();
  });
});
