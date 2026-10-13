/**
 * project — task management (P1 API).
 *
 * Covers PJ-060, PJ-062, PJ-063, PJ-064, PJ-065, PJ-066, PJ-068, PJ-070, PJ-071.
 * (PJ-075 complete+archive via the board is an E2E case; see project-ui-p1.spec.ts.)
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
  setProjectMembers,
  type RegisteredUser,
} from '../helpers/api';

const baseURL = baseURLFor('project');
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

test.describe("【任务管理】项目任务管理（P1 API）（project task management (P1 API)）", () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  let user: RegisteredUser;
  test.beforeAll(async () => {
    if (!baseURL) return;
    user = await registerUser(baseURL);
  });

  // PJ-060 任务描述为空/超长被拒
  test("【任务管理 / API】 PJ-060 任务描述为空/超长被拒", async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `任务校验${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, user.token, pid);

    const empty = await apiPost(baseURL!, '/api/project/task/add', { project_id: pid, column_id: cid, name: '' }, user.token);
    expect(empty.ret).toBe(0);
    expect(empty.msg).toBe('任务描述不能为空');

    const tooLong = await apiPost(
      baseURL!,
      '/api/project/task/add',
      { project_id: pid, column_id: cid, name: '长'.repeat(256) },
      user.token,
    );
    expect(tooLong.ret).toBe(0);
    expect(tooLong.msg).toBe('任务描述最多只能设置255个字');
  });

  // PJ-062 获取单个任务信息
  test("【任务管理 / API】 PJ-062 获取单个任务信息", async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `单任务${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, user.token, pid);
    const { id: tid } = await addTask(baseURL!, user.token, { projectId: pid, columnId: cid, name: '查看用任务' });

    const body = await apiGet(baseURL!, `/api/project/task/one?task_id=${tid}`, user.token);
    expect(body.ret).toBe(1);
    expect(Number(body.data.id)).toBe(tid);
    expect(body.data).toHaveProperty('project_name');
    expect(body.data).toHaveProperty('column_name');
  });

  // PJ-063 无权限查看任务返回无任务权限
  test("【任务管理 / API】 PJ-063 无权限查看任务返回无任务权限", async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `私密任务${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, user.token, pid);
    const member = await registerUser(baseURL!);
    await setProjectMembers(baseURL!, user.token, pid, [user.userid, member.userid]);

    // Create a task visible only to its owner (the creator), not the plain member.
    const added = await apiPost(
      baseURL!,
      '/api/project/task/add',
      { project_id: pid, column_id: cid, name: '仅负责人可见', owner: [user.userid], visibility: 2 },
      user.token,
    );
    expect(added.ret).toBe(1);
    const tid = Number(added.data.id);

    const denied = await apiGet(baseURL!, `/api/project/task/one?task_id=${tid}`, member.token);
    expect(denied.ret).not.toBe(1);
    expect(denied.msg).toBe('无任务权限');
    expect(Number(denied.data.task_id)).toBe(tid);
    expect(Number(denied.data.force)).toBe(1);
  });

  // PJ-064 添加子任务(继承父任务)
  test("【任务管理 / API】 PJ-064 添加子任务(继承父任务)", async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `子任务${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, user.token, pid);
    const { id: tid } = await addTask(baseURL!, user.token, { projectId: pid, columnId: cid, name: '父任务' });

    const body = await apiPost(baseURL!, '/api/project/task/addsub', { task_id: tid, name: '子任务A' }, user.token);
    expect(body.ret).toBe(1);
    expect(body.msg).toBe('添加成功');
    expect(Number(body.data.parent_id)).toBe(tid);
    expect(Number(body.data.column_id)).toBe(cid);
  });

  // PJ-065 主任务已完成禁止加子任务
  test("【任务管理 / API】 PJ-065 主任务已完成禁止加子任务", async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `完成父${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, user.token, pid);
    const { id: tid } = await addTask(baseURL!, user.token, {
      projectId: pid,
      columnId: cid,
      name: '已完成父任务',
      ownerId: user.userid,
    });
    const done = await apiPost(baseURL!, '/api/project/task/update', { task_id: tid, complete_at: now() }, user.token);
    expect(done.ret).toBe(1);

    const body = await apiPost(baseURL!, '/api/project/task/addsub', { task_id: tid, name: '迟到子任务' }, user.token);
    expect(body.ret).toBe(0);
    expect(body.msg).toBe('主任务已完成无法添加子任务');
  });

  // PJ-066 修改任务(负责人/协助人上限)
  test("【任务管理 / API】 PJ-066 修改任务(名称/负责人/时间)", async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `改任务${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, user.token, pid);
    const { id: tid } = await addTask(baseURL!, user.token, { projectId: pid, columnId: cid, name: '待改任务' });

    // A valid rename succeeds.
    const rename = await apiPost(baseURL!, '/api/project/task/update', { task_id: tid, name: '改后任务名' }, user.token);
    expect(rename.ret).toBe(1);
    expect(rename.msg).toBe('修改成功');

    const tooManyOwners = await apiPost(
      baseURL!,
      '/api/project/task/update',
      { task_id: tid, owner: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
      user.token,
    );
    expect(tooManyOwners.ret).toBe(0);
    expect(tooManyOwners.msg).toBe('任务负责人最多不能超过10个');

    const tooManyAssists = await apiPost(
      baseURL!,
      '/api/project/task/update',
      { task_id: tid, assist: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
      user.token,
    );
    expect(tooManyAssists.ret).toBe(0);
    expect(tooManyAssists.msg).toBe('任务协助人员最多不能超过10个');
  });

  // PJ-068 任务移动到其它列表
  test("【任务管理 / API】 PJ-068 任务移动到其它列表/项目", async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `移动${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, user.token, pid);
    const col2 = await apiPost(baseURL!, '/api/project/column/add', { project_id: pid, name: '目标列' }, user.token);
    expect(col2.ret).toBe(1);
    const cid2 = Number(col2.data.id);
    const { id: tid } = await addTask(baseURL!, user.token, { projectId: pid, columnId: cid, name: '待移动任务' });

    // task/move is gated behind a client-version check; identify as the web client.
    const moved = await apiGet(
      baseURL!,
      `/api/project/task/move?task_id=${tid}&project_id=${pid}&column_id=${cid2}&flow_item_id=0`,
      user.token,
      { platform: 'web' },
    );
    expect(moved.ret).toBe(1);
    expect(moved.msg).toBe('移动成功');

    const badTarget = await apiGet(
      baseURL!,
      `/api/project/task/move?task_id=${tid}&project_id=${pid}&column_id=99999999&flow_item_id=0`,
      user.token,
      { platform: 'web' },
    );
    expect(badTarget.ret).not.toBe(1);
    expect(badTarget.msg).toBe('列表不存在');
  });

  // PJ-070 归档任务与恢复
  test("【任务管理 / API】 PJ-070 归档任务与恢复", async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `归档任务${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, user.token, pid);
    // Only a *completed* task may be archived, so create it owned by us and complete it.
    const { id: tid } = await addTask(baseURL!, user.token, {
      projectId: pid,
      columnId: cid,
      name: '归档主任务',
      ownerId: user.userid,
    });
    const done = await apiPost(baseURL!, '/api/project/task/update', { task_id: tid, complete_at: now() }, user.token);
    expect(done.ret).toBe(1);

    const arch = await apiGet(baseURL!, `/api/project/task/archived?task_id=${tid}&type=add`, user.token);
    expect(arch.ret).toBe(1);
    expect(arch.msg).toBe('操作成功');
    const recover = await apiGet(baseURL!, `/api/project/task/archived?task_id=${tid}&type=recovery`, user.token);
    expect(recover.ret).toBe(1);
    expect(recover.msg).toBe('操作成功');

    // A subtask cannot be archived regardless of completion state.
    const parent = await addTask(baseURL!, user.token, { projectId: pid, columnId: cid, name: '含子任务的父任务' });
    const sub = await apiPost(baseURL!, '/api/project/task/addsub', { task_id: parent.id, name: '子任务' }, user.token);
    expect(sub.ret).toBe(1);
    const subId = Number(sub.data.id);
    const subArch = await apiGet(baseURL!, `/api/project/task/archived?task_id=${subId}&type=add`, user.token);
    expect(subArch.ret).toBe(0);
    expect(subArch.msg).toBe('子任务不支持此功能');
  });

  // PJ-071 删除任务与恢复
  test("【任务管理 / API】 PJ-071 删除任务与恢复", async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `删任务${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, user.token, pid);
    const { id: tid } = await addTask(baseURL!, user.token, { projectId: pid, columnId: cid, name: '待删除任务' });

    const del = await apiGet(baseURL!, `/api/project/task/remove?task_id=${tid}&type=delete`, user.token);
    expect(del.ret).toBe(1);
    expect(del.msg).toBe('删除成功');

    const rec = await apiGet(baseURL!, `/api/project/task/remove?task_id=${tid}&type=recovery`, user.token);
    expect(rec.ret).toBe(1);
    expect(rec.msg).toBe('操作成功');
  });
});
