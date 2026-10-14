/**
 * project — dashboard search, nav badges & 404 routing (P2 UI).
 *
 * Covers PJ-026 (dashboard search shortcut), PJ-033 (overdue-task nav badge),
 * PJ-035 (unknown route renders the 404 page), PJ-140 (non-existent page
 * renders 404).
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';
import { seedUiSession } from '../helpers/session';
import { apiGet, apiPost, createProject, firstColumnId } from '../helpers/api';

const baseURL = baseURLFor('project');

test.describe(localizedTitle("【导航与 SPA 布局】项目仪表板搜索/徽章/404 (P2 UI)（project dashboard search / badges / 404 (P2 UI)）", "project dashboard search / badges / 404 (P2 UI)"), () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  // PJ-026 仪表盘搜索快捷入口
  test(localizedTitle("【仪表盘 / UI】 PJ-026 仪表盘搜索快捷入口", "PJ-026 the dashboard search shortcut opens the global search box"), async ({ page }) => {
    await seedUiSession(page, baseURL!);
    await expect(page.getByText('以下是你当前的任务统计数据')).toBeVisible({ timeout: 20_000 });

    // The search shortcut on the dashboard header opens the global SearchBox modal.
    await page.locator('.dashboard-search').first().click();
    await expect(page.locator('.common-search-box-modal')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder('请输入关键字').first()).toBeVisible();
  });

  // PJ-033 未读消息/超期任务角标显示
  test(localizedTitle("【导航与 SPA 布局 / UI】 PJ-033 未读消息/超期任务角标显示", "PJ-033 an overdue task surfaces the dashboard nav badge"), async ({ page }) => {
    const acc = await seedUiSession(page, baseURL!);
    const { id: pid } = await createProject(baseURL!, acc.token, { name: `角标项目${Date.now() % 100000}` });
    const cid = await firstColumnId(baseURL!, acc.token, pid);
    // A task owned by me with an end time in the past is counted as overdue,
    // which drives the red badge on the dashboard nav entry.
    const added = await apiPost(
      baseURL!,
      '/api/project/task/add',
      { project_id: pid, column_id: cid, name: '超期任务', owner: [acc.userid], times: ['2020-01-01 09:00', '2020-01-02 18:00'] },
      acc.token,
    );
    expect(added.ret, `task/add failed: ${added.msg}`).toBe(1);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('以下是你当前的任务统计数据')).toBeVisible({ timeout: 20_000 });
    // The nav badge renders once the dashboard task cache reports the overdue task.
    await expect(page.locator('.menu-badge').first()).toBeVisible({ timeout: 15_000 });
  });

  // PJ-035 访问未知路由渲染 404 页面
  test(localizedTitle("【导航与 SPA 布局 / UI】 PJ-035 访问未知路由渲染 404 页面", "PJ-035 an unknown manage route renders the 404 page"), async ({ page }) => {
    await page.addInitScript(() => {
      try {
        (globalThis as any).localStorage.setItem('__system:languageName__', 'zh');
      } catch {
        /* ignore */
      }
    });
    await page.goto('/#/manage/this-route-does-not-exist-xyz', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.page-404')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.page-404 .code')).toHaveText('404');
    await expect(page.locator('.page-404 .message')).toHaveText('Not Found');
  });

  // PJ-140 访问不存在页面渲染 404
  test(localizedTitle("【系统、健康与错误异常 / UI】 PJ-140 访问不存在页面渲染 404", "PJ-140 a non-existent top-level route renders the 404 page"), async ({ page }) => {
    await page.goto('/#/no-such-page-xyz-12345', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.page-404')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('404').first()).toBeVisible();
    await expect(page.getByText('Not Found').first()).toBeVisible();
  });
});
