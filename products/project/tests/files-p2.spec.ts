/**
 * project — file cabinet edge cases (P2 API).
 *
 * Covers PJ-099 (save + read document content), PJ-100 (share a file and then
 * exit a share as a non-owner member).
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
import { test, expect, baseURLFor } from '../fixtures';
import { registerUser, apiGet, apiPost, withDeadlockRetry } from '../helpers/api';

const baseURL = baseURLFor('project');

test.describe("【文件管理(文件柜)】项目文件（P2 API）（project files (P2 API)）", () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  // PJ-099 保存与获取文件内容
  test("【文件管理(文件柜) / API】 PJ-099 保存与获取文件内容", async () => {
    const user = await registerUser(baseURL!);
    const add = await withDeadlockRetry(() =>
      apiPost(baseURL!, '/api/file/add', { type: 'document', name: `笔记${Date.now() % 100000}`, pid: 0 }, user.token),
    );
    expect(add.ret, `file/add failed: ${add.msg}`).toBe(1);
    const fid = Number(add.data.id);
    expect(add.data.ext).toBe('md');

    const marker = `# hello ${Date.now()}`;
    const saved = await apiPost(
      baseURL!,
      '/api/file/content/save',
      { id: fid, content: JSON.stringify({ content: marker, type: 'md' }) },
      user.token,
    );
    expect(saved.ret, `content/save failed: ${saved.msg}`).toBe(1);
    expect(saved.msg).toBe('保存成功');

    const got = await apiGet(baseURL!, `/api/file/content?id=${fid}`, user.token);
    expect(got.ret).toBe(1);
    expect(got.data.content.type).toBe('md');
    expect(got.data.content.content).toBe(marker);
  });

  // PJ-100 文件共享设置与退出共享
  test("【文件管理(文件柜) / API】 PJ-100 文件共享设置与退出共享", async () => {
    const owner = await registerUser(baseURL!);
    const member = await registerUser(baseURL!);

    const add = await withDeadlockRetry(() =>
      apiPost(baseURL!, '/api/file/add', { type: 'document', name: `共享${Date.now() % 100000}`, pid: 0 }, owner.token),
    );
    expect(add.ret, `file/add failed: ${add.msg}`).toBe(1);
    const fid = Number(add.data.id);

    // Owner shares the file to the member with read/write permission.
    const shared = await withDeadlockRetry(() =>
      apiPost(baseURL!, '/api/file/share/update', { id: fid, userids: [member.userid], permission: 1 }, owner.token),
    );
    expect(shared.ret, `share/update failed: ${shared.msg}`).toBe(1);
    expect(shared.msg).toBe('设置成功');
    expect(Number(shared.data.share)).toBe(1);

    // The member (a non-owner participant) can leave the share.
    const out = await withDeadlockRetry(() => apiPost(baseURL!, '/api/file/share/out', { id: fid }, member.token));
    expect(out.ret, `share/out failed: ${out.msg}`).toBe(1);
    expect(out.msg).toBe('退出成功');
  });
});
