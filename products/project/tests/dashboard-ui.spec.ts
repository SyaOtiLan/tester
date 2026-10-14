/**
 * project — dashboard & SPA navigation (UI).
 *
 * Covers PJ-023, PJ-030.
 *
 * A logged-in UI session is seeded by registering a throwaway account over the
 * API and injecting its token through the SPA's URL-param bootstrap
 * (`?userid=&token=`). See helpers/session.ts.
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';
import { seedUiSession } from '../helpers/session';

const baseURL = baseURLFor('project');

test.describe(localizedTitle("【dashboard ui】项目仪表板和导航 (UI)（project dashboard & navigation (UI)）", "project dashboard & navigation (UI)"), () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  // PJ-023 登录后进入仪表盘并显示任务统计
  test(localizedTitle("【仪表盘 / E2E】 PJ-023 登录后进入仪表盘并显示任务统计", "PJ-023 dashboard shows the title and the task-statistics section"), async ({ page }) => {
    await seedUiSession(page, baseURL!);
    // Wait for the SPA to boot into the dashboard view.
    await expect(page.getByText('以下是你当前的任务统计数据')).toBeVisible({ timeout: 20_000 });
    // The dashboard PageTitle renders "仪表盘".
    await expect(page.getByText('仪表盘', { exact: true }).first()).toBeVisible();
  });

  // PJ-030 侧栏渲染五个主入口
  test(localizedTitle("【导航与 SPA 布局 / UI】 PJ-030 侧栏渲染五个主入口", "PJ-030 sidebar renders the five primary entries"), async ({ page }) => {
    await seedUiSession(page, baseURL!);
    await expect(page.getByText('以下是你当前的任务统计数据')).toBeVisible({ timeout: 20_000 });
    for (const label of ['仪表盘', '日历', '消息', '文件', '应用']) {
      await expect(page.locator('.menu-title', { hasText: label }).first()).toBeVisible();
    }
  });
});
