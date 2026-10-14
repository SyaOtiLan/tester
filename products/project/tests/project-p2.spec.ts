/**
 * project — project management edge cases (P2 API).
 *
 * Covers PJ-046 (transfer owner), PJ-047 (top / un-top), PJ-048 (personal
 * project ordering), PJ-057 (column sort, only_column), PJ-081 (delete
 * workflow), PJ-089 (department read-only view — admin, skipped), PJ-092 (tag
 * count capped at 100).
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
  projectApi,
  createProject,
  firstColumnId,
  setProjectMembers,
  withDeadlockRetry,
} from '../helpers/api';

const baseURL = baseURLFor('project');

test.describe(localizedTitle("【项目管理】项目管理（P2 API）（project management (P2 API)）", "project management (P2 API)"), () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  // PJ-046 移交项目负责人
  test(localizedTitle("【项目管理 / API】 PJ-046 移交项目负责人", "PJ-046 project/transfer hands ownership to another member"), async () => {
    const owner = await registerUser(baseURL!);
    const heir = await registerUser(baseURL!);
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `移交项目${Date.now() % 100000}` });
    await setProjectMembers(baseURL!, owner.token, pid, [owner.userid, heir.userid]);

    const moved = await withDeadlockRetry(() =>
      apiPost(baseURL!, '/api/project/transfer', { project_id: pid, owner_userid: heir.userid }, owner.token),
    );
    expect(moved.ret, `transfer failed: ${moved.msg}`).toBe(1);
    expect(moved.msg).toBe('移交成功');

    // The new owner can now perform owner-only actions (e.g. read the project as
    // its owner); the old owner is demoted to a plain member.
    const asHeir = await apiGet(baseURL!, `/api/project/one?project_id=${pid}`, heir.token);
    expect(asHeir.ret).toBe(1);
    expect(Number(asHeir.data.owner_userid ?? asHeir.data.userid)).toBe(heir.userid);
  });

  // PJ-047 项目置顶/取消置顶
  test(localizedTitle("【项目管理 / API】 PJ-047 项目置顶/取消置顶", "PJ-047 project/top pins and then un-pins a project"), async () => {
    const user = await registerUser(baseURL!);
    const { id: pid } = await createProject(baseURL!, user.token, { name: `置顶项目${Date.now() % 100000}` });

    const pin = await apiGet(baseURL!, `/api/project/top?project_id=${pid}`, user.token);
    expect(pin.ret).toBe(1);
    expect(Number(pin.data.id)).toBe(pid);
    expect(pin.data.top_at, 'first toggle should set a top timestamp').toBeTruthy();

    const unpin = await apiGet(baseURL!, `/api/project/top?project_id=${pid}`, user.token);
    expect(unpin.ret).toBe(1);
    expect(Number(unpin.data.id)).toBe(pid);
    // Toggling again clears the pin.
    expect(unpin.data.top_at == null || unpin.data.top_at === '').toBe(true);
  });

  // PJ-048 项目列表排序
  test(localizedTitle("【项目管理 / API】 PJ-048 项目列表排序", "PJ-048 project/user/sort persists a personal project ordering"), async () => {
    const user = await registerUser(baseURL!);
    const a = await createProject(baseURL!, user.token, { name: `排序A${Date.now() % 100000}` });
    const b = await createProject(baseURL!, user.token, { name: `排序B${Date.now() % 100000}` });

    const sorted = await apiPost(baseURL!, '/api/project/user/sort', { sort: [b.id, a.id] }, user.token);
    expect(sorted.ret, `user/sort failed: ${sorted.msg}`).toBe(1);
    expect(sorted.msg).toBe('排序已保存');
  });

  // PJ-057 列表排序(sort only_column)
  test(localizedTitle("【任务列表(看板列) / API】 PJ-057 列表排序(sort only_column)", "PJ-057 project/sort with only_column reorders the board columns"), async () => {
    const user = await registerUser(baseURL!);
    const { id: pid } = await createProject(baseURL!, user.token, { name: `列排序${Date.now() % 100000}` });
    // Ensure at least two columns.
    const c1 = await firstColumnId(baseURL!, user.token, pid);
    const added = await apiPost(baseURL!, '/api/project/column/add', { project_id: pid, name: '第二列' }, user.token);
    expect(added.ret).toBe(1);
    const c2 = Number(added.data.id);

    const sorted = await apiPost(
      baseURL!,
      '/api/project/sort',
      { project_id: pid, sort: [{ id: c2 }, { id: c1 }], only_column: 1 },
      user.token,
    );
    expect(sorted.ret, `sort failed: ${sorted.msg}`).toBe(1);
    expect(sorted.msg).toBe('调整成功');
  });

  // PJ-081 删除工作流
  test(localizedTitle("【工作流与状态流转 / API】 PJ-081 删除工作流", "PJ-081 project/flow/delete removes the project workflow"), async () => {
    const user = await registerUser(baseURL!);
    // flow:'open' seeds a Default workflow with 5 flow items.
    const { id: pid } = await createProject(baseURL!, user.token, { name: `删流程${Date.now() % 100000}`, flow: 'open' });

    const before = await apiGet(baseURL!, `/api/project/flow/list?project_id=${pid}`, user.token);
    expect(before.ret).toBe(1);
    expect((before.data ?? []).length).toBeGreaterThan(0);

    const del = await apiPost(baseURL!, '/api/project/flow/delete', { project_id: pid }, user.token);
    expect(del.ret, `flow/delete failed: ${del.msg}`).toBe(1);
    expect(del.msg).toBe('删除成功');

    const after = await apiGet(baseURL!, `/api/project/flow/list?project_id=${pid}`, user.token);
    expect(after.ret).toBe(1);
    expect((after.data ?? []).length).toBe(0);
  });

  // PJ-089 部门只读视角查看项目
  test(localizedTitle("【项目成员与权限 / API】 PJ-089 部门只读视角查看项目", "PJ-089 department read-only project view"), async () => {
    test.skip(true, 'Requires an admin-configured department + department-scoped read role; the site admin account is captcha-locked so this cannot be provisioned with a throwaway user.');
  });

  // PJ-092 标签数超 100 被拒
  test(localizedTitle("【任务标签与日志 / API】 PJ-092 标签数超 100 被拒", "PJ-092 tag/save rejects the 101st tag on a project"), async () => {
    // Seeding 100 tags is 100 individual writes. Reuse ONE keep-alive request
    // context (instead of the per-call context the apiPost helper builds and
    // tears down) so the burst drains quickly and minimises its contention
    // window on the shared MySQL; still give a generous budget for a slow run.
    test.setTimeout(120_000);
    const user = await registerUser(baseURL!);
    const { id: pid } = await createProject(baseURL!, user.token, { name: `标签上限${Date.now() % 100000}` });

    const ctx = await projectApi(baseURL!, user.token);
    try {
      for (let n = 0; n < 100; n++) {
        let body: any = null;
        for (let attempt = 0; attempt < 15; attempt++) {
          const res = await ctx.post('/api/project/tag/save', {
            data: { project_id: pid, name: `标签${n}`, color: '#33aa55' },
          });
          body = await res.json();
          if (body.ret === 1 || !/deadlock|serialization/i.test(body.msg ?? '')) break;
          await new Promise((r) => setTimeout(r, 60 + Math.floor(Math.random() * 140)));
        }
        expect(body.ret, `tag/save #${n} failed: ${body?.msg}`).toBe(1);
      }
    } finally {
      await ctx.dispose();
    }

    const over = await apiPost(
      baseURL!,
      '/api/project/tag/save',
      { project_id: pid, name: `超额标签${Date.now()}`, color: '#33aa55' },
      user.token,
    );
    expect(over.ret).toBe(0);
    expect(over.msg).toBe('每个项目最多添加100个标签');
  });
});
