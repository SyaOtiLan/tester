/**
 * project — counts & search (P2 API).
 *
 * Covers PJ-029 (user/counts project+task totals), PJ-131 (member search),
 * PJ-134 (contact search), PJ-135 (file/message search), PJ-141 (demo account),
 * PJ-129 (department CRUD — admin, skipped).
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';
import {
  registerUser,
  apiGet,
  apiPost,
  createProject,
  firstColumnId,
  addTask,
  withDeadlockRetry,
  type RegisteredUser,
} from '../helpers/api';

const baseURL = baseURLFor('project');

test.describe(localizedTitle("【search p2】项目计数和搜索 (P2 API)（project counts & search (P2 API)）", "project counts & search (P2 API)"), () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  // PJ-029 user/counts 返回项目/任务数量
  test(localizedTitle("【仪表盘 / API】 PJ-029 user/counts 返回项目/任务数量", "PJ-029 project/user/counts returns project and task tallies"), async () => {
    const user = await registerUser(baseURL!);
    const { id: pid } = await createProject(baseURL!, user.token, { name: `计数项目${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, user.token, pid);
    await addTask(baseURL!, user.token, { projectId: pid, columnId: cid, name: '计数任务', ownerId: user.userid });

    const body = await apiGet(baseURL!, `/api/project/user/counts?userid=${user.userid}`, user.token);
    expect(body.ret).toBe(1);
    expect(body.data).toHaveProperty('project');
    expect(body.data).toHaveProperty('todo');
    expect(body.data).toHaveProperty('done');
    expect(Number(body.data.project)).toBeGreaterThanOrEqual(1);
    expect(Number(body.data.todo)).toBeGreaterThanOrEqual(1);
  });

  // PJ-131 会员搜索
  test(localizedTitle("【团队/会员管理(管理员) / API】 PJ-131 会员搜索", "PJ-131 users/search finds a member by e-mail"), async () => {
    const me = await registerUser(baseURL!);
    const other = await registerUser(baseURL!);

    const body = await apiGet(
      baseURL!,
      `/api/users/search?keys[key]=${encodeURIComponent(other.email)}`,
      me.token,
    );
    expect(body.ret).toBe(1);
    expect(Array.isArray(body.data)).toBe(true);
    const hit = body.data.find((u: any) => Number(u.userid) === other.userid);
    expect(hit, 'searched member not found').toBeTruthy();
  });

  // PJ-134 搜索联系人
  test(localizedTitle("【搜索 / API】 PJ-134 搜索联系人", "PJ-134 search/contact finds a contact by e-mail"), async () => {
    const me = await registerUser(baseURL!);
    const other = await registerUser(baseURL!);

    const body = await apiGet(baseURL!, `/api/search/contact?key=${encodeURIComponent(other.email)}`, me.token);
    expect(body.ret).toBe(1);
    expect(Array.isArray(body.data)).toBe(true);
    const hit = body.data.find((u: any) => Number(u.userid) === other.userid);
    expect(hit, 'searched contact not found').toBeTruthy();
  });

  // PJ-135 搜索文件/消息
  test(localizedTitle("【搜索 / API】 PJ-135 搜索文件/消息", "PJ-135 search/file and search/message find created content"), async () => {
    const user = await registerUser(baseURL!);

    // File search: create a document with a distinctive name and find it.
    const fileMarker = `zebra${Date.now() % 100000}`;
    const add = await withDeadlockRetry(() =>
      apiPost(baseURL!, '/api/file/add', { type: 'document', name: fileMarker, pid: 0 }, user.token),
    );
    expect(add.ret, `file/add failed: ${add.msg}`).toBe(1);
    const fileHit = await apiGet(baseURL!, `/api/search/file?key=${fileMarker}`, user.token);
    expect(fileHit.ret).toBe(1);
    expect(Array.isArray(fileHit.data)).toBe(true);
    expect(fileHit.data.some((f: any) => f.name === fileMarker), 'file not found by search').toBe(true);

    // Message search: post a message with a distinctive token and find it.
    const open = await apiGet(baseURL!, `/api/dialog/open/user?userid=${user.userid}`, user.token);
    expect(open.ret).toBe(1);
    const dialogId = Number(open.data.id);
    const msgMarker = `msgword${Date.now() % 100000}`;
    const sent = await withDeadlockRetry(() =>
      apiPost(baseURL!, '/api/dialog/msg/sendtext', { dialog_id: dialogId, text: `搜索测试 ${msgMarker}` }, user.token),
    );
    expect(sent.ret, `sendtext failed: ${sent.msg}`).toBe(1);
    const msgHit = await apiGet(baseURL!, `/api/search/message?key=${msgMarker}`, user.token);
    expect(msgHit.ret).toBe(1);
    expect(Array.isArray(msgHit.data)).toBe(true);
    expect(msgHit.data.length, 'message not found by search').toBeGreaterThan(0);
  });

  // PJ-141 获取演示账号(demo)
  test(localizedTitle("【系统、健康与错误异常 / API】 PJ-141 获取演示账号(demo)", "PJ-141 system/demo returns a demo account or reports it disabled"), async () => {
    const body = await apiGet(baseURL!, '/api/system/demo');
    // Demo accounts are an optional deployment feature: when enabled the endpoint
    // returns {account, password}; when disabled it returns ret=0 'No demo account'.
    // Both are valid, contractually-defined responses.
    if (body.ret === 1) {
      expect(body.data).toHaveProperty('account');
      expect(body.data).toHaveProperty('password');
    } else {
      expect(body.ret).toBe(0);
      expect(body.msg).toBe('No demo account');
    }
  });

  // PJ-129 部门列表增删改
  test(localizedTitle("【团队/会员管理(管理员) / API】 PJ-129 部门列表增删改", "PJ-129 department list add/update/delete"), async () => {
    test.skip(true, 'users/department/* requires auth("admin"); the site admin account is captcha-locked and cannot be driven with a throwaway user.');
  });
});
