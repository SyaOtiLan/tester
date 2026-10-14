/**
 * project — task lists / columns (P1 API).
 *
 * Covers PJ-053, PJ-054, PJ-055, PJ-056.
 * (PJ-058 add-column via the board is an E2E case; see project-ui-p1.spec.ts.)
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';
import { registerUser, apiGet, apiPost, createProject, firstColumnId, type RegisteredUser } from '../helpers/api';

const baseURL = baseURLFor('project');

test.describe(localizedTitle("【任务列表(看板列)】项目栏/任务列表 (P1 API)（project columns / task lists (P1 API)）", "project columns / task lists (P1 API)"), () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  let user: RegisteredUser;
  test.beforeAll(async () => {
    if (!baseURL) return;
    user = await registerUser(baseURL);
  });

  // PJ-053 空列表名被拒
  test(localizedTitle("【任务列表(看板列) / API】 PJ-053 空列表名被拒", "PJ-053 an empty column name is rejected"), async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `空列名${Date.now() % 100000}` });
    const body = await apiPost(baseURL!, '/api/project/column/add', { project_id: pid, name: '' }, user.token);
    expect(body.ret).toBe(0);
    expect(body.msg).toBe('列表名称不能为空');
  });

  // PJ-054 修改列表名称/颜色
  test(localizedTitle("【任务列表(看板列) / API】 PJ-054 修改列表名称/颜色", "PJ-054 update a column name and color; unknown column is rejected"), async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `改列${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, user.token, pid);
    const ok = await apiPost(
      baseURL!,
      '/api/project/column/update',
      { column_id: cid, name: '进行中', color: '#3296fa' },
      user.token,
    );
    expect(ok.ret).toBe(1);
    expect(ok.msg).toBe('修改成功');
    expect(ok.data.name).toBe('进行中');

    const missing = await apiPost(baseURL!, '/api/project/column/update', { column_id: 99999999, name: 'x' }, user.token);
    expect(missing.ret).toBe(0);
    expect(missing.msg).toBe('列表不存在');
  });

  // PJ-055 删除列表(权限)
  test(localizedTitle("【任务列表(看板列) / API】 PJ-055 删除列表(权限)", "PJ-055 delete a column; unknown column is rejected"), async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `删列${Date.now() % 100000}` });
    // Add a second column so the project still has one after removal.
    const added = await apiPost(baseURL!, '/api/project/column/add', { project_id: pid, name: '待删除' }, user.token);
    expect(added.ret).toBe(1);
    const cid = Number(added.data.id);

    const ok = await apiGet(baseURL!, `/api/project/column/remove?column_id=${cid}`, user.token);
    expect(ok.ret).toBe(1);
    expect(ok.msg).toBe('删除成功');

    const missing = await apiGet(baseURL!, '/api/project/column/remove?column_id=99999999', user.token);
    expect(missing.ret).toBe(0);
    expect(missing.msg).toBe('列表不存在');
  });

  // PJ-056 获取任务列表(column/lists)
  test(localizedTitle("【任务列表(看板列) / API】 PJ-056 获取任务列表(column/lists)", "PJ-056 column/lists returns the project columns, paginated"), async () => {
    const { id: pid } = await createProject(baseURL!, user.token, { name: `列清单${Date.now() % 100000}` });
    await apiPost(baseURL!, '/api/project/column/add', { project_id: pid, name: '需求池' }, user.token);
    const body = await apiGet(baseURL!, `/api/project/column/lists?project_id=${pid}`, user.token);
    expect(body.ret).toBe(1);
    const rows = body.data?.data ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const key of ['id', 'name', 'sort']) {
      expect(rows[0], `column row missing ${key}`).toHaveProperty(key);
    }
  });
});
