/**
 * project — members & permissions (P1 API).
 *
 * Covers PJ-084, PJ-085, PJ-086, PJ-087, PJ-088.
 *
 * PJ-085 (appoint/dismiss deputy) is a project-primary-owner operation — NOT a
 * site-admin one — so it is reachable with throwaway accounts.
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';
import { registerUser, apiGet, apiPost, createProject, setProjectMembers, withDeadlockRetry, type RegisteredUser } from '../helpers/api';

const baseURL = baseURLFor('project');

test.describe(localizedTitle("【项目成员与权限】项目成员和权限（P1 API）（project members & permissions (P1 API)）", "project members & permissions (P1 API)"), () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  let owner: RegisteredUser;
  test.beforeAll(async () => {
    if (!baseURL) return;
    owner = await registerUser(baseURL);
  });

  // PJ-084 成员列表必须含负责人
  test(localizedTitle("【项目成员与权限 / API】 PJ-084 成员列表必须含负责人", "PJ-084 the member list must contain the project owner"), async () => {
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `含负责人${Date.now() % 100000}` });
    const member = await registerUser(baseURL!);
    const body = await apiPost(baseURL!, '/api/project/user', { project_id: pid, userid: [member.userid] }, owner.token);
    expect(body.ret).toBe(0);
    expect(body.msg).toBe('项目成员列表必须包含项目负责人');
  });

  // PJ-085 任命/罢免项目管理员(仅负责人)
  test(localizedTitle("【项目成员与权限 / API】 PJ-085 任命/罢免项目管理员(仅负责人)", "PJ-085 owner appoints then dismisses a deputy; a non-member cannot be appointed"), async () => {
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `任命${Date.now() % 100000}` });
    const member = await registerUser(baseURL!);
    await setProjectMembers(baseURL!, owner.token, pid, [owner.userid, member.userid]);

    const appoint = await withDeadlockRetry(() =>
      apiPost(baseURL!, '/api/project/adddeputy', { project_id: pid, userid: member.userid }, owner.token),
    );
    expect(appoint.ret).toBe(1);
    expect(appoint.msg).toBe('任命成功');

    const dismiss = await withDeadlockRetry(() =>
      apiPost(baseURL!, '/api/project/deldeputy', { project_id: pid, userid: member.userid }, owner.token),
    );
    expect(dismiss.ret).toBe(1);
    expect(dismiss.msg).toBe('罢免成功');

    const outsider = await registerUser(baseURL!);
    const denied = await apiPost(baseURL!, '/api/project/adddeputy', { project_id: pid, userid: outsider.userid }, owner.token);
    expect(denied.ret).toBe(0);
    expect(denied.msg).toBe('该用户不是项目成员');
  });

  // PJ-086 成员数超 100 被拒
  test(localizedTitle("【项目成员与权限 / API】 PJ-086 成员数超 100 被拒", "PJ-086 more than 100 members is rejected"), async () => {
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `超员${Date.now() % 100000}` });
    // owner + 100 placeholder ids = 101 entries -> over the limit.
    const ids = [owner.userid, ...Array.from({ length: 100 }, (_, i) => 900000 + i)];
    const body = await apiPost(baseURL!, '/api/project/user', { project_id: pid, userid: ids }, owner.token);
    expect(body.ret).toBe(0);
    expect(body.msg).toBe('项目人数最多100个');
  });

  // PJ-087 获取项目权限设置
  test(localizedTitle("【项目成员与权限 / API】 PJ-087 获取项目权限设置", "PJ-087 project/permission returns the role-id arrays"), async () => {
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `权限读取${Date.now() % 100000}` });
    const body = await apiGet(baseURL!, `/api/project/permission?project_id=${pid}`, owner.token);
    expect(body.ret).toBe(1);
    const perms = body.data?.permissions ?? body.data;
    expect(perms).toHaveProperty('task_add');
    expect(Array.isArray(perms.task_add)).toBe(true);
  });

  // PJ-088 更新项目权限设置
  test(localizedTitle("【项目成员与权限 / API】 PJ-088 更新项目权限设置", "PJ-088 project/permission/update saves the permission map"), async () => {
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `权限更新${Date.now() % 100000}` });
    const body = await apiPost(
      baseURL!,
      '/api/project/permission/update',
      { project_id: pid, task_add: [1, 2] },
      owner.token,
    );
    expect(body.ret).toBe(1);
    const perms = body.data?.permissions ?? body.data;
    expect(perms).toHaveProperty('task_add');
  });
});
