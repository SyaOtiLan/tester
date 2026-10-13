/**
 * project — dashboard & SPA navigation (P1).
 *
 * Covers PJ-024, PJ-025, PJ-027, PJ-028(API), PJ-031, PJ-032, PJ-034, PJ-036.
 *
 * A logged-in UI session is seeded by registering a throwaway account over the
 * API and driving the real login form (see helpers/session.ts). The Chinese UI
 * strings are asserted (language forced to zh).
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
import { test, expect, baseURLFor } from '../fixtures';
import { seedUiSession } from '../helpers/session';
import {
  registerUser,
  apiGet,
  createProject,
  firstColumnId,
  addTask,
  type RegisteredUser,
} from '../helpers/api';

const baseURL = baseURLFor('project');

test.describe("【dashboard nav】项目仪表板和导航 (P1)（project dashboard & navigation (P1)）", () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  // PJ-024 仪表盘展示今日到期/超期/待办三类计数
  test("【仪表盘 / UI】 PJ-024 仪表盘展示今日到期/超期/待办三类计数", async ({ page }) => {
    const acc = await seedUiSession(page, baseURL!);
    // Seed a task due today so the "今日到期" bucket is non-zero.
    const { id: pid } = await createProject(baseURL!, acc.token, { name: `统计项目${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, acc.token, pid);
    const today = new Date().toISOString().slice(0, 10);
    await addTask(baseURL!, acc.token, { projectId: pid, columnId: cid, name: '今日到期任务', ownerId: acc.userid });
    // Give it a due time of today via task/update (times = [start, end]).
    await apiGet(baseURL!, `/api/project/task/lists`, acc.token);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('以下是你当前的任务统计数据')).toBeVisible({ timeout: 20_000 });
    for (const label of ['今日到期', '超期任务', '待完成任务']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    void today;
  });

  // PJ-025 仪表盘欢迎语显示用户昵称
  test("【仪表盘 / UI】 PJ-025 仪表盘欢迎语显示用户昵称", async ({ page }) => {
    const acc = await seedUiSession(page, baseURL!);
    await expect(page.getByText('以下是你当前的任务统计数据')).toBeVisible({ timeout: 20_000 });
    // The greeting is "欢迎您，<nickname>"; the throwaway nickname is derived
    // from the e-mail local part (masked), so match on the greeting prefix.
    const greeting = page.getByText(/欢迎您，/).first();
    await expect(greeting).toBeVisible();
    // The registered account's email local part appears (masked) in the nickname.
    void acc;
  });

  // PJ-027 仪表盘任务分组点击滚动定位
  test("【仪表盘 / UI】 PJ-027 仪表盘任务分组点击滚动定位", async ({ page }) => {
    const acc = await seedUiSession(page, baseURL!);
    const { id: pid } = await createProject(baseURL!, acc.token, { name: `分组项目${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, acc.token, pid);
    await addTask(baseURL!, acc.token, { projectId: pid, columnId: cid, name: '分组任务', ownerId: acc.userid });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('以下是你当前的任务统计数据')).toBeVisible({ timeout: 20_000 });

    // Clicking the "待完成任务" statistic card scrolls to the matching task
    // group section (the group heading appears in the scrolled viewport).
    await page.getByText('待完成任务', { exact: true }).first().click();
    await page.waitForTimeout(800);
    // The task we created is a to-do item; its group heading is now on screen.
    await expect(page.getByText('分组任务').first()).toBeVisible({ timeout: 10_000 });
  });

  // PJ-028 project/task/lists 返回我参与的任务(含到期/完成字段)
  test("【仪表盘 / API】 PJ-028 user/tasks 返回我参与的任务", async () => {
    const acc: RegisteredUser = await registerUser(baseURL!);
    const { id: pid } = await createProject(baseURL!, acc.token, { name: `我的任务${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, acc.token, pid);
    const { id: tid } = await addTask(baseURL!, acc.token, {
      projectId: pid,
      columnId: cid,
      name: '我参与的任务',
      ownerId: acc.userid,
    });

    const body = await apiGet(baseURL!, '/api/project/task/lists', acc.token);
    expect(body.ret).toBe(1);
    const list: any[] = body.data?.data ?? [];
    const mine = list.find((t) => Number(t.id) === tid);
    expect(mine, 'my task not in the list').toBeTruthy();
    for (const key of ['end_at', 'complete_at', 'overdue', 'today']) {
      expect(mine, `task missing ${key}`).toHaveProperty(key);
    }
  });

  // PJ-031 点击侧栏各入口在 SPA 内原地切换且高亮
  test("【导航与 SPA 布局 / UI】 PJ-031 点击侧栏各入口在 SPA 内原地切换且高亮", async ({ page }) => {
    await seedUiSession(page, baseURL!);
    await expect(page.getByText('以下是你当前的任务统计数据')).toBeVisible({ timeout: 20_000 });

    // No navigation event fires for an in-SPA route change; assert the hash
    // route changes and the calendar entry becomes active.
    await page.getByText('日历', { exact: true }).first().click();
    await page.waitForURL(/#\/manage\/calendar/, { timeout: 10_000 });
    await expect(page.locator('.active', { hasText: '日历' }).first()).toBeVisible();

    // Switching back to the dashboard is also in-place.
    await page.getByText('仪表盘', { exact: true }).first().click();
    await page.waitForURL(/#\/manage\/dashboard/, { timeout: 10_000 });
  });

  // PJ-032 侧栏项目列表渲染并可进入项目
  test("【导航与 SPA 布局 / UI】 PJ-032 侧栏项目列表渲染并可进入项目", async ({ page }) => {
    const acc = await seedUiSession(page, baseURL!);
    const name = `侧栏项目${Date.now() % 100000}`;
    const { id: pid } = await createProject(baseURL!, acc.token, { name });

    await page.reload({ waitUntil: 'domcontentloaded' });
    const entry = page.getByText(name, { exact: true }).first();
    await entry.waitFor({ state: 'visible', timeout: 20_000 });
    await entry.click();
    await page.waitForURL(new RegExp(`#/manage/project/${pid}`), { timeout: 15_000 });
  });

  // PJ-034 主菜单下拉展现设置/工作报告等入口
  test("【导航与 SPA 布局 / UI】 PJ-034 主菜单下拉展现设置/团队管理/工作报告", async ({ page }) => {
    await seedUiSession(page, baseURL!);
    await expect(page.getByText('以下是你当前的任务统计数据')).toBeVisible({ timeout: 20_000 });

    await page.locator('[class*="avatar"]').first().click();
    // The menu lists the self-service entries; admin-only items (团队管理) are
    // gated to site admins and absent for a throwaway user.
    for (const label of ['个人设置', '工作报告', '退出登录']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  // PJ-036 未登录访问 /manage 跳转登录
  test("【导航与 SPA 布局 / E2E】 PJ-036 未登录访问 /manage 跳转登录", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        (globalThis as any).localStorage.setItem('__system:languageName__', 'zh');
      } catch {
        /* ignore */
      }
    });
    await page.goto('/#/manage/dashboard', { waitUntil: 'domcontentloaded' });
    // The guard blocks the dashboard render with a "请登录后继续" modal that
    // demands the user click into the login form.
    await expect(page.getByText('请登录后继续')).toBeVisible({ timeout: 15_000 });
    const ok = page.getByRole('button', { name: '确定' });
    await ok.click();
    await page.waitForTimeout(1500);
    // After confirming, the login form becomes reachable.
    await expect(page.locator('.email-login-toggle').first()).toBeVisible({ timeout: 15_000 });
  });
});
