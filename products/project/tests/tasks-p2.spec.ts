/**
 * project — task edge cases (P2 API).
 *
 * Covers PJ-069 (copy a task into a target project), PJ-072 (open/create a
 * task chat room), PJ-073 (task owner/assist list capped at 10).
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
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

test.describe("【任务管理】项目任务（P2 API）（project tasks (P2 API)）", () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  let user: RegisteredUser;
  test.beforeAll(async () => {
    if (!baseURL) return;
    user = await registerUser(baseURL);
  });

  // PJ-069 复制任务到目标项目
  test("【任务管理 / API】 PJ-069 复制任务到目标项目", async () => {
    const src = await createProject(baseURL!, user.token, { name: `复制源${Date.now() % 100000}` });
    const srcCol = await firstColumnId(baseURL!, user.token, src.id);
    const { id: tid } = await addTask(baseURL!, user.token, {
      projectId: src.id,
      columnId: srcCol,
      name: '待复制任务',
      ownerId: user.userid,
    });

    const dst = await createProject(baseURL!, user.token, { name: `复制目标${Date.now() % 100000}` });
    const dstCol = await firstColumnId(baseURL!, user.token, dst.id);

    const copied = await withDeadlockRetry(() =>
      apiPost(baseURL!, '/api/project/task/copy', { task_id: tid, project_id: dst.id, column_id: dstCol }, user.token),
    );
    expect(copied.ret, `task/copy failed: ${copied.msg}`).toBe(1);
    expect(copied.msg).toBe('复制成功');
    const newId = Number(copied.data.id);
    expect(newId).toBeGreaterThan(0);
    expect(newId).not.toBe(tid);
    expect(Number(copied.data.project_id)).toBe(dst.id);
  });

  // PJ-072 创建/获取任务聊天室
  test("【任务管理 / API】 PJ-072 创建/获取任务聊天室", async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `任务群${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, user.token, pid);
    const { id: tid } = await addTask(baseURL!, user.token, {
      projectId: pid,
      columnId: cid,
      name: '带聊天室的任务',
      ownerId: user.userid,
    });

    const opened = await withDeadlockRetry(() => apiGet(baseURL!, `/api/project/task/dialog?task_id=${tid}`, user.token));
    expect(opened.ret, `task/dialog failed: ${opened.msg}`).toBe(1);
    const dialogId = Number(opened.data.dialog_id);
    expect(dialogId).toBeGreaterThan(0);
    expect(opened.data.dialog_data.group_type).toBe('task');

    // Re-opening returns the same dialog (idempotent).
    const again = await apiGet(baseURL!, `/api/project/task/dialog?task_id=${tid}`, user.token);
    expect(again.ret).toBe(1);
    expect(Number(again.data.dialog_id)).toBe(dialogId);
  });

  // PJ-073 任务负责人/协助人超 10 个被拒
  test("【任务管理 / API】 PJ-073 任务负责人/协助人超 10 个被拒", async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `负责人上限${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, user.token, pid);
    const { id: tid } = await addTask(baseURL!, user.token, {
      projectId: pid,
      columnId: cid,
      name: '多负责人任务',
      ownerId: user.userid,
    });

    // 11 owner ids trip the count guard before any membership validation.
    const owners = Array.from({ length: 11 }, (_, i) => 900000 + i);
    const rejected = await apiPost(baseURL!, '/api/project/task/update', { task_id: tid, owner: owners }, user.token);
    expect(rejected.ret).toBe(0);
    expect(rejected.msg).toBe('任务负责人最多不能超过10个');
  });
});
