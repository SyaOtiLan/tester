/**
 * project — project / list / task / workflow / members (API).
 *
 * Covers PJ-037, PJ-039, PJ-052, PJ-059, PJ-061, PJ-067, PJ-076, PJ-077, PJ-083.
 *
 * All cases run under a freshly registered throwaway account (see helpers/api).
 * Registration auto-creates a personal project, so project/lists is never empty.
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
  type RegisteredUser,
} from '../helpers/api';

const baseURL = baseURLFor('project');

test.describe(localizedTitle("【任务管理】项目/任务/工作流程 (API)（project / task / workflow (API)）", "project / task / workflow (API)"), () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  let user: RegisteredUser;
  test.beforeAll(async () => {
    if (!baseURL) return;
    user = await registerUser(baseURL);
  });

  // PJ-037 创建项目返回项目与默认列表
  test(localizedTitle("【项目管理 / API】 PJ-037 创建项目返回项目与默认列表", "PJ-037 project/add returns the project with the creator as owner"), async () => {
    const body = await apiPost(baseURL!, '/api/project/add', { name: `建项目${Date.now() % 100000}` }, user.token);
    expect(body.ret).toBe(1);
    expect(body.msg).toBe('添加成功');
    expect(Number(body.data.id)).toBeGreaterThan(0);
    // Creator becomes the project owner.
    expect(Number(body.data.userid)).toBe(user.userid);

    // A default column is created and is retrievable via column/lists.
    const cols = await apiGet(baseURL!, `/api/project/column/lists?project_id=${body.data.id}`, user.token);
    expect(cols.ret).toBe(1);
    expect((cols.data?.data ?? []).length).toBeGreaterThan(0);
  });

  // PJ-039 获取项目列表含任务统计
  test(localizedTitle("【项目管理 / API】 PJ-039 获取项目列表含任务统计", "PJ-039 project/lists is paginated and carries task statistics"), async () => {
    // Ensure at least one project exists beyond the auto-created personal one.
    await createProject(baseURL!, user.token, { name: `列表用${Date.now() % 100000}` });
    const body = await apiGet(baseURL!, '/api/project/lists', user.token);
    expect(body.ret).toBe(1);
    const rows = body.data?.data ?? [];
    expect(rows.length).toBeGreaterThan(0);
    const p = rows[0];
    for (const key of ['owner', 'task_num', 'task_complete', 'task_percent']) {
      expect(p, `project row missing ${key}`).toHaveProperty(key);
    }
  });

  // PJ-052 添加任务列表
  test(localizedTitle("【任务列表(看板列) / API】 PJ-052 添加任务列表", "PJ-052 column/add appends a list to the project"), async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `列项目${Date.now() % 100000}` });
    const body = await apiPost(baseURL!, '/api/project/column/add', { project_id: pid, name: '需求池' }, user.token);
    expect(body.ret).toBe(1);
    expect(body.msg).toBe('添加成功');
    expect(body.data.name).toBe('需求池');
    expect(Number(body.data.id)).toBeGreaterThan(0);
    // A newly added column starts empty and gets an auto sort value.
    expect(Array.isArray(body.data.project_task)).toBe(true);
    expect(body.data).toHaveProperty('sort');
  });

  // PJ-059 添加任务返回任务详情
  test(localizedTitle("【任务管理 / API】 PJ-059 添加任务返回任务详情", "PJ-059 task/add returns the full task detail"), async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `任项目${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, user.token, pid);
    const body = await apiPost(
      baseURL!,
      '/api/project/task/add',
      { project_id: pid, column_id: cid, name: '第一个任务' },
      user.token,
    );
    expect(body.ret).toBe(1);
    expect(body.msg).toBe('添加成功');
    expect(body.data.name).toBe('第一个任务');
    expect(Number(body.data.project_id)).toBe(pid);
    expect(Number(body.data.column_id)).toBe(cid);
    // Computed fields present on the returned task.
    for (const key of ['percent', 'sub_num', 'today', 'overdue']) {
      expect(body.data, `task missing ${key}`).toHaveProperty(key);
    }
  });

  // PJ-061 获取任务列表(过滤/分页)
  test(localizedTitle("【任务管理 / API】 PJ-061 获取任务列表(过滤/分页)", "PJ-061 task/lists honors status filter and returns computed fields"), async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `过滤${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, user.token, pid);
    await addTask(baseURL!, user.token, { projectId: pid, columnId: cid, name: '未完成任务A' });

    const body = await apiGet(
      baseURL!,
      `/api/project/task/lists?project_id=${pid}&keys[status]=uncompleted`,
      user.token,
    );
    expect(body.ret).toBe(1);
    const rows = body.data?.data ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const key of ['percent', 'sub_num', 'today', 'overdue']) {
      expect(rows[0], `task row missing ${key}`).toHaveProperty(key);
    }
  });

  // PJ-067 完成任务与取消完成
  test(localizedTitle("【任务管理 / API】 PJ-067 完成任务与取消完成", "PJ-067 complete then un-complete a task"), async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `完成${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, user.token, pid);
    // Task must be owned by the actor, otherwise completing returns "请先领取任务".
    const { id: tid } = await addTask(baseURL!, user.token, {
      projectId: pid,
      columnId: cid,
      name: '待完成任务',
      ownerId: user.userid,
    });

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const done = await apiPost(baseURL!, '/api/project/task/update', { task_id: tid, complete_at: now }, user.token);
    expect(done.ret).toBe(1);
    expect(done.msg).toBe('修改成功');
    expect(done.data.complete_at).toBeTruthy();

    const undone = await apiPost(baseURL!, '/api/project/task/update', { task_id: tid, complete_at: false }, user.token);
    expect(undone.ret).toBe(1);
    expect(undone.msg).toBe('修改成功');
    expect(undone.data.complete_at).toBeFalsy();
  });

  // PJ-076 获取任务工作流可流转状态
  test(localizedTitle("【工作流与状态流转 / API】 PJ-076 获取任务工作流可流转状态", "PJ-076 task/flow returns the current state and reachable turns"), async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `流程${Date.now() % 100000}`, flow: 'open' });
    const cid = await firstColumnId(baseURL!, user.token, pid);
    const { id: tid } = await addTask(baseURL!, user.token, {
      projectId: pid,
      columnId: cid,
      name: '工作流任务',
      ownerId: user.userid,
    });

    const body = await apiGet(baseURL!, `/api/project/task/flow?task_id=${tid}`, user.token);
    expect(body.ret).toBe(1);
    expect(body.data).toHaveProperty('flow_item_id');
    const turns = body.data?.turns ?? [];
    expect(turns.length).toBeGreaterThan(0);
    for (const key of ['id', 'status', 'name']) {
      expect(turns[0], `turn missing ${key}`).toHaveProperty(key);
    }
  });

  // PJ-077 通过 flow_item_id 流转任务状态
  test(localizedTitle("【工作流与状态流转 / API】 PJ-077 通过 flow_item_id 流转任务状态", "PJ-077 transition a task via flow_item_id; reaching an end state completes it"), async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `流转${Date.now() % 100000}`, flow: 'open' });
    const cid = await firstColumnId(baseURL!, user.token, pid);
    const { id: tid } = await addTask(baseURL!, user.token, {
      projectId: pid,
      columnId: cid,
      name: '流转任务',
      ownerId: user.userid,
    });

    const flow = await apiGet(baseURL!, `/api/project/task/flow?task_id=${tid}`, user.token);
    const turns: any[] = flow.data?.turns ?? [];
    const progress = turns.find((t) => t.status === 'progress');
    expect(progress, 'expected a "progress" turn').toBeTruthy();

    const moved = await apiPost(
      baseURL!,
      '/api/project/task/update',
      { task_id: tid, flow_item_id: progress.id },
      user.token,
    );
    expect(moved.ret).toBe(1);
    expect(moved.msg).toBe('修改成功');
    expect(Number(moved.data.flow_item_id)).toBe(Number(progress.id));

    // Now move to an end state — the task should auto-complete.
    const flow2 = await apiGet(baseURL!, `/api/project/task/flow?task_id=${tid}`, user.token);
    const endTurn = (flow2.data?.turns ?? []).find((t: any) => t.status === 'end');
    expect(endTurn, 'expected an "end" turn').toBeTruthy();
    const ended = await apiPost(
      baseURL!,
      '/api/project/task/update',
      { task_id: tid, flow_item_id: endTurn.id },
      user.token,
    );
    expect(ended.ret).toBe(1);
    expect(ended.data.complete_at).toBeTruthy();
  });

  // PJ-083 修改项目成员列表
  test(localizedTitle("【项目成员与权限 / API】 PJ-083 修改项目成员列表", "PJ-083 project/user updates the member list"), async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `成员${Date.now() % 100000}` });
    // The member list must include the owner; here we (re)assert the owner as sole member.
    const body = await apiPost(baseURL!, '/api/project/user', { project_id: pid, userid: [user.userid] }, user.token);
    expect(body.ret).toBe(1);
    expect(body.msg).toBe('修改成功');
  });
});
