/**
 * project — task labels & operation logs (P1 API).
 *
 * Covers PJ-090, PJ-091, PJ-093, PJ-094.
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

test.describe("【任务标签与日志】项目标签和日志 (P1 API)（project labels & logs (P1 API)）", () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  let owner: RegisteredUser;
  test.beforeAll(async () => {
    if (!baseURL) return;
    owner = await registerUser(baseURL);
  });

  // PJ-090 创建/更新任务标签
  test("【任务标签与日志 / API】 PJ-090 创建/更新任务标签", async () => {
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `标签${Date.now() % 100000}` });
    const create = await apiPost(
      baseURL!,
      '/api/project/tag/save',
      { project_id: pid, name: '紧急', color: '#ff0000' },
      owner.token,
    );
    expect(create.ret).toBe(1);
    expect(create.msg).toBe('保存成功');
    const tagId = Number(create.data.id);
    expect(tagId).toBeGreaterThan(0);

    const rename = await apiPost(
      baseURL!,
      '/api/project/tag/save',
      { project_id: pid, id: tagId, name: '非常紧急', color: '#ff3300' },
      owner.token,
    );
    expect(rename.ret).toBe(1);
    expect(rename.data.name).toBe('非常紧急');
  });

  // PJ-091 标签名/颜色必填校验
  test("【任务标签与日志 / API】 PJ-091 标签名/颜色必填校验", async () => {
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `标签校验${Date.now() % 100000}` });

    const noName = await apiPost(baseURL!, '/api/project/tag/save', { project_id: pid, color: '#ff0000' }, owner.token);
    expect(noName.ret).toBe(0);
    expect(noName.msg).toBe('请输入标签名称');

    const noColor = await apiPost(baseURL!, '/api/project/tag/save', { project_id: pid, name: '标签A' }, owner.token);
    expect(noColor.ret).toBe(0);
    expect(noColor.msg).toBe('请选择标签颜色');

    const noProject = await apiPost(baseURL!, '/api/project/tag/save', { name: '标签A', color: '#ff0000' }, owner.token);
    expect(noProject.ret).toBe(0);
    expect(noProject.msg).toBe('参数错误');
  });

  // PJ-093 删除标签(权限)
  test("【任务标签与日志 / API】 PJ-093 删除标签(权限)", async () => {
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `删标签${Date.now() % 100000}` });
    const member = await registerUser(baseURL!);
    await setProjectMembers(baseURL!, owner.token, pid, [owner.userid, member.userid]);

    const create = await apiPost(
      baseURL!,
      '/api/project/tag/save',
      { project_id: pid, name: '待删标签', color: '#00aa00' },
      owner.token,
    );
    expect(create.ret).toBe(1);
    const tagId = Number(create.data.id);

    const denied = await apiGet(baseURL!, `/api/project/tag/delete?id=${tagId}`, member.token);
    expect(denied.ret).toBe(0);
    expect(denied.msg).toBe('没有权限删除标签');

    const ok = await apiGet(baseURL!, `/api/project/tag/delete?id=${tagId}`, owner.token);
    expect(ok.ret).toBe(1);
    expect(ok.msg).toBe('删除成功');
  });

  // PJ-094 获取项目/任务操作日志
  test("【任务标签与日志 / API】 PJ-094 获取项目/任务操作日志", async () => {
    const { id: pid } = await createProject(baseURL!, owner.token, { name: `日志${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, owner.token, pid);
    await addTask(baseURL!, owner.token, { projectId: pid, columnId: cid, name: '产生日志的任务' });

    const body = await apiGet(baseURL!, `/api/project/log/lists?project_id=${pid}`, owner.token);
    expect(body.ret).toBe(1);
    const rows = body.data?.data ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('detail');
    expect(rows[0]).toHaveProperty('time');
  });
});
