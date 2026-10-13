/**
 * project — project management CRUD (P1 API).
 *
 * Covers PJ-038, PJ-040, PJ-041, PJ-042, PJ-043, PJ-044, PJ-045, PJ-049.
 * (PJ-051 board load is an E2E case; see project-ui-p1.spec.ts.)
 *
 * Every case uses freshly registered throwaway accounts. Cases that exercise a
 * non-owner path register a second account and add it to the project.
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
  setProjectMembers,
  withDeadlockRetry,
  type RegisteredUser,
} from '../helpers/api';

const baseURL = baseURLFor('project');

test.describe("【项目管理】项目管理 CRUD (P1 API)（project management CRUD (P1 API)）", () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  let owner: RegisteredUser;
  test.beforeAll(async () => {
    if (!baseURL) return;
    owner = await registerUser(baseURL);
  });

  // PJ-038 项目名称少于2字/超32字被拒
  test("【项目管理 / API】 PJ-038 项目名称少于2字/超32字被拒", async () => {
    const tooShort = await apiPost(baseURL!, '/api/project/add', { name: 'x' }, owner.token);
    expect(tooShort.ret).toBe(0);
    expect(tooShort.msg).toBe('项目名称不可以少于2个字');

    const tooLong = await apiPost(baseURL!, '/api/project/add', { name: '一'.repeat(33) }, owner.token);
    expect(tooLong.ret).toBe(0);
    expect(tooLong.msg).toBe('项目名称最多只能设置32个字');
  });

  // PJ-040 获取单个项目信息
  test("【项目管理 / API】 PJ-040 获取单个项目信息", async () => {
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `单项目${Date.now() % 100000}` });
    const ok = await apiGet(baseURL!, `/api/project/one?project_id=${pid}`, owner.token);
    expect(ok.ret).toBe(1);
    expect(Number(ok.data.id)).toBe(pid);
    expect(ok.data).toHaveProperty('project_user');

    const missing = await apiGet(baseURL!, '/api/project/one?project_id=99999999', owner.token);
    expect(missing.ret).not.toBe(1);
    expect(missing.msg).toBe('项目不存在或不在成员列表内');
  });

  // PJ-041 修改项目(负责人权限)
  test("【项目管理 / API】 PJ-041 修改项目(负责人权限)", async () => {
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `改前${Date.now() % 100000}` });
    const newName = `改后${Date.now() % 100000}`;
    const body = await apiPost(
      baseURL!,
      '/api/project/update',
      { project_id: pid, name: newName, desc: '更新后的介绍' },
      owner.token,
    );
    expect(body.ret).toBe(1);
    expect(body.msg).toBe('修改成功');
    expect(body.data.name).toBe(newName);
  });

  // PJ-042 非负责人修改项目被拒
  test("【项目管理 / API】 PJ-042 非负责人修改项目被拒", async () => {
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `权限项目${Date.now() % 100000}` });
    const member = await registerUser(baseURL!);
    await setProjectMembers(baseURL!, owner.token, pid, [owner.userid, member.userid]);

    const body = await apiPost(baseURL!, '/api/project/update', { project_id: pid, name: '越权改名' }, member.token);
    expect(body.ret).not.toBe(1);
    expect(body.msg).toBe('仅限项目负责人操作');
  });

  // PJ-043 归档项目与恢复
  test("【项目管理 / API】 PJ-043 归档项目与恢复", async () => {
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `归档项目${Date.now() % 100000}` });
    const arch = await apiGet(baseURL!, `/api/project/archived?project_id=${pid}&type=add`, owner.token);
    expect(arch.ret).toBe(1);
    expect(arch.msg).toBe('操作成功');

    const recover = await apiGet(baseURL!, `/api/project/archived?project_id=${pid}&type=recovery`, owner.token);
    expect(recover.ret).toBe(1);
    expect(recover.msg).toBe('操作成功');
  });

  // PJ-044 删除项目(仅负责人)
  test("【项目管理 / API】 PJ-044 删除项目(仅负责人)", async () => {
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `删除项目${Date.now() % 100000}` });
    const member = await registerUser(baseURL!);
    await setProjectMembers(baseURL!, owner.token, pid, [owner.userid, member.userid]);

    const denied = await apiGet(baseURL!, `/api/project/remove?project_id=${pid}`, member.token);
    expect(denied.ret).not.toBe(1);
    expect(denied.msg).toBe('仅限项目负责人操作');

    const ok = await apiGet(baseURL!, `/api/project/remove?project_id=${pid}`, owner.token);
    expect(ok.ret).toBe(1);
    expect(ok.msg).toBe('删除成功');
  });

  // PJ-045 退出项目(负责人禁止)
  test("【项目管理 / API】 PJ-045 退出项目(负责人禁止)", async () => {
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `退出项目${Date.now() % 100000}` });
    const member = await registerUser(baseURL!);
    await setProjectMembers(baseURL!, owner.token, pid, [owner.userid, member.userid]);

    const memberExit = await withDeadlockRetry(() =>
      apiGet(baseURL!, `/api/project/exit?project_id=${pid}`, member.token),
    );
    expect(memberExit.ret).toBe(1);
    expect(memberExit.msg).toBe('退出成功');

    const ownerExit = await apiGet(baseURL!, `/api/project/exit?project_id=${pid}`, owner.token);
    expect(ownerExit.ret).not.toBe(1);
    expect(ownerExit.msg).toBe('禁止项目负责人操作');
  });

  // PJ-049 生成邀请链接并通过邀请加入
  test("【项目管理 / API】 PJ-049 生成邀请链接并通过邀请加入", async () => {
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `邀请项目${Date.now() % 100000}` });
    const invite = await apiGet(baseURL!, `/api/project/invite?project_id=${pid}`, owner.token);
    expect(invite.ret).toBe(1);
    const url: string = invite.data.url;
    expect(typeof url).toBe('string');
    const code = url.split('/invite/').pop()!;
    expect(code.length).toBeGreaterThan(0);

    const joiner = await registerUser(baseURL!);
    const info = await apiGet(baseURL!, `/api/project/invite/info?code=${encodeURIComponent(code)}`, joiner.token);
    expect(info.ret).toBe(1);

    const join = await withDeadlockRetry(() =>
      apiGet(baseURL!, `/api/project/invite/join?code=${encodeURIComponent(code)}`, joiner.token),
    );
    expect(join.ret).toBe(1);
    expect(join.msg).toBe('加入成功');

    // Re-joining is idempotent.
    const again = await apiGet(baseURL!, `/api/project/invite/join?code=${encodeURIComponent(code)}`, joiner.token);
    expect(again.ret).toBe(1);
    expect(again.msg).toBe('已加入');
  });
});
