/**
 * project — search, system & error handling (P1 API).
 *
 * Covers PJ-132, PJ-133, PJ-137, PJ-138, PJ-139.
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
  type RegisteredUser,
} from '../helpers/api';

const baseURL = baseURLFor('project');

test.describe("【系统、健康与错误异常】项目搜索/系统（P1 API）（project search / system (P1 API)）", () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  let user: RegisteredUser;
  test.beforeAll(async () => {
    if (!baseURL) return;
    user = await registerUser(baseURL);
  });

  // PJ-132 搜索项目
  test("【搜索 / API】 PJ-132 搜索项目", async () => {
    const uniq = `Zsou${Date.now() % 1000000}`;
    await createProject(baseURL!, user.token, { name: `搜索项目${uniq}` });
    const body = await apiGet(baseURL!, `/api/search/project?key=${uniq}`, user.token);
    expect(body.ret).toBe(1);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((p: any) => String(p.name).includes(uniq))).toBe(true);
  });

  // PJ-133 搜索任务
  test("【搜索 / API】 PJ-133 搜索任务", async () => {
    const uniq = `Ztask${Date.now() % 1000000}`;
    const { id: pid } = await createProject(baseURL!, user.token, { name: `搜任务${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, user.token, pid);
    await addTask(baseURL!, user.token, { projectId: pid, columnId: cid, name: `任务${uniq}` });

    const body = await apiGet(baseURL!, `/api/search/task?key=${uniq}`, user.token);
    expect(body.ret).toBe(1);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((t: any) => String(t.name).includes(uniq))).toBe(true);
  });

  // PJ-137 获取系统设置
  test("【系统、健康与错误异常 / API】 PJ-137 获取系统设置", async () => {
    const body = await apiGet(baseURL!, '/api/system/setting', user.token);
    expect(body.ret).toBe(1);
    expect(body.data).toHaveProperty('reg');
    expect(body.data).toHaveProperty('login_code');
  });

  // PJ-138 非法方法名返回 404 not found
  test("【系统、健康与错误异常 / API】 PJ-138 非法方法名返回 404 not found", async () => {
    const body = await apiPost(baseURL!, '/api/users/nonexist', {}, user.token);
    expect(body.ret).toBe(0);
    expect(body.msg).toContain('404 not found');
    expect(body.msg).toContain('nonexist');
  });

  // PJ-139 缺少必填参数返回参数错误
  test("【系统、健康与错误异常 / API】 PJ-139 缺少必填参数返回参数错误", async () => {
    const body = await apiGet(baseURL!, '/api/project/tag/list', user.token);
    expect(body.ret).toBe(0);
    expect(body.msg).toBe('参数错误');
  });
});
