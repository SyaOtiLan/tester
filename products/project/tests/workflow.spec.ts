/**
 * project — workflow / state machine (P1 API).
 *
 * Covers PJ-078, PJ-079, PJ-080, PJ-082.
 *
 * Flow contract on this deployment:
 *   - POST /api/project/flow/save takes `flows[]`, each item having
 *     `name`, `status: 'start'|'progress'|'test'|'end'|…`, and `turns[]`
 *     (allowed next flow-item ids). It replaces the whole project flow and
 *     returns the created items (with fresh ids) under
 *     `data.project_flow_item`.
 *   - A first save with `turns: []` yields self-only turns; to wire real
 *     transitions we save a *second* time, passing each item's `id` (to keep
 *     it) and its wired `turns`.
 *   - `start` and `end` are both required; the flow is capped at 10 states.
 *   - A state with `userlimit: 1` + `userids: [...]` may only be *left* by one
 *     of those users (or the project owner).
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
  withDeadlockRetry,
  type RegisteredUser,
} from '../helpers/api';

const baseURL = baseURLFor('project');

interface FlowItem {
  id: number;
  status: string;
  name: string;
  turns: number[];
  userlimit: number;
  userids: number[];
}

async function saveFlow(
  token: string,
  projectId: number,
  flows: Array<Record<string, unknown>>,
): Promise<{ ret: number; msg: string; data: { project_flow_item: FlowItem[] } }> {
  return apiPost(baseURL!, '/api/project/flow/save', { project_id: projectId, flows }, token);
}

const byStatus = (items: FlowItem[], status: string) => items.find((i) => i.status === status)!;

/**
 * Create a linear A(start) -> B(progress) -> C(end) flow with real turn wiring.
 * `progressUserlimit`, when set, locks the progress state to those user ids.
 * Returns the wired item ids.
 */
async function wireLinearFlow(
  token: string,
  projectId: number,
  progressUserlimit?: number[],
): Promise<{ start: number; progress: number; end: number }> {
  const first = await saveFlow(token, projectId, [
    { name: 'A', status: 'start', turns: [] },
    { name: 'B', status: 'progress', turns: [] },
    { name: 'C', status: 'end', turns: [] },
  ]);
  expect(first.ret, `flow/save failed: ${first.msg}`).toBe(1);
  const a = byStatus(first.data.project_flow_item, 'start').id;
  const b = byStatus(first.data.project_flow_item, 'progress').id;
  const c = byStatus(first.data.project_flow_item, 'end').id;

  const progress: Record<string, unknown> = { id: b, name: 'B', status: 'progress', turns: [a, b, c] };
  if (progressUserlimit) {
    progress.userlimit = 1;
    progress.userids = progressUserlimit;
  }
  const second = await saveFlow(token, projectId, [
    { id: a, name: 'A', status: 'start', turns: [a, b] },
    progress,
    { id: c, name: 'C', status: 'end', turns: [c] },
  ]);
  expect(second.ret, `flow/save (wire) failed: ${second.msg}`).toBe(1);
  return { start: a, progress: b, end: c };
}

test.describe("【工作流与状态流转】项目工作流程 (P1 API)（project workflow (P1 API)）", () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  // PJ-080 保存工作流(至少一开始一结束)
  test("【工作流与状态流转 / API】 PJ-080 保存工作流(至少一开始一结束)", async () => {
    const owner = await registerUser(baseURL!);
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `保存流程${Date.now() % 100000}` });

    const ok = await saveFlow(owner.token, pid, [
      { name: 'A', status: 'start', turns: [] },
      { name: 'B', status: 'progress', turns: [] },
      { name: 'C', status: 'end', turns: [] },
    ]);
    expect(ok.ret).toBe(1);
    expect(ok.msg).toBe('保存成功');

    const missingEnd = await saveFlow(owner.token, pid, [{ name: 'A', status: 'start', turns: [] }]);
    expect(missingEnd.ret).toBe(0);
    expect(missingEnd.msg).toBe('至少需要1个结束状态');

    const missingStart = await saveFlow(owner.token, pid, [
      { name: 'B', status: 'progress', turns: [] },
      { name: 'C', status: 'end', turns: [] },
    ]);
    expect(missingStart.ret).toBe(0);
    expect(missingStart.msg).toBe('至少需要1个开始状态');

    const eleven = Array.from({ length: 11 }, (_, i) => ({
      name: `S${i}`,
      status: i === 0 ? 'start' : i === 10 ? 'end' : 'progress',
      turns: [],
    }));
    const tooMany = await saveFlow(owner.token, pid, eleven);
    expect(tooMany.ret).toBe(0);
    expect(tooMany.msg).toBe('流程状态最多不能超过10个');
  });

  // PJ-078 非法状态流转被拒
  test("【工作流与状态流转 / API】 PJ-078 非法状态流转被拒", async () => {
    const owner = await registerUser(baseURL!);
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `非法流转${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, owner.token, pid);
    const ids = await wireLinearFlow(owner.token, pid);
    const { id: tid } = await addTask(baseURL!, owner.token, {
      projectId: pid,
      columnId: cid,
      name: '流转任务',
      ownerId: owner.userid,
    });

    // Re-applying the current (start) state is a no-op.
    const same = await apiPost(
      baseURL!,
      '/api/project/task/update',
      { task_id: tid, flow_item_id: ids.start },
      owner.token,
    );
    expect(same.ret).toBe(0);
    expect(same.msg).toBe('任务状态未发生改变');

    // start -> end is not in the start turn set.
    const illegal = await apiPost(
      baseURL!,
      '/api/project/task/update',
      { task_id: tid, flow_item_id: ids.end },
      owner.token,
    );
    expect(illegal.ret).toBe(0);
    expect(illegal.msg).toMatch(/^当前状态\[.+\]不可流转到\[.+\]$/);

    // start -> progress IS legal.
    const legal = await apiPost(
      baseURL!,
      '/api/project/task/update',
      { task_id: tid, flow_item_id: ids.progress },
      owner.token,
    );
    expect(legal.ret).toBe(1);
    expect(legal.msg).toBe('修改成功');
  });

  // PJ-079 多个结束状态需选择
  test("【工作流与状态流转 / API】 PJ-079 多个结束状态需选择", async () => {
    const owner = await registerUser(baseURL!);
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `多结束${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, owner.token, pid);

    const saved = await saveFlow(owner.token, pid, [
      { name: 'A', status: 'start', turns: [] },
      { name: 'C', status: 'end', turns: [] },
      { name: 'D', status: 'end', turns: [] },
    ]);
    expect(saved.ret).toBe(1);

    const { id: tid } = await addTask(baseURL!, owner.token, {
      projectId: pid,
      columnId: cid,
      name: '待完成任务',
      ownerId: owner.userid,
    });

    const complete = await apiPost(
      baseURL!,
      '/api/project/task/update',
      { task_id: tid, complete_at: '2026-09-16 12:00:00' },
      owner.token,
    );
    expect(complete.ret).not.toBe(1);
    expect(complete.msg).toBe('存在多个结束状态，请选择要使用的状态');
    expect(Array.isArray(complete.data?.flow_items)).toBe(true);
    expect(complete.data.flow_items.length).toBe(2);
  });

  // PJ-082 状态负责人限制流转
  test("【工作流与状态流转 / API】 PJ-082 状态负责人限制流转", async () => {
    const owner = await registerUser(baseURL!);
    const member = await registerUser(baseURL!);
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `状态负责${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, owner.token, pid);
    await setProjectMembers(baseURL!, owner.token, pid, [owner.userid, member.userid]);

    // Lock the progress state to the owner only.
    const ids = await wireLinearFlow(owner.token, pid, [owner.userid]);

    // Task assigned to the member so the member has task_status rights.
    const { id: tid } = await addTask(baseURL!, owner.token, {
      projectId: pid,
      columnId: cid,
      name: '受限流转任务',
      ownerId: member.userid,
    });

    // Owner parks the task in the userlimited progress state.
    const toProgress = await withDeadlockRetry(() =>
      apiPost(baseURL!, '/api/project/task/update', { task_id: tid, flow_item_id: ids.progress }, owner.token),
    );
    expect(toProgress.ret).toBe(1);

    // The member cannot move it out of the owner-locked state.
    const denied = await apiPost(
      baseURL!,
      '/api/project/task/update',
      { task_id: tid, flow_item_id: ids.end },
      member.token,
    );
    expect(denied.ret).toBe(0);
    expect(denied.msg).toMatch(/^当前状态\[.+\]仅限状态负责人或项目负责人修改$/);

    // The project owner still can.
    const ok = await apiPost(
      baseURL!,
      '/api/project/task/update',
      { task_id: tid, flow_item_id: ids.end },
      owner.token,
    );
    expect(ok.ret).toBe(1);
  });
});
