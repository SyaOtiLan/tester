/**
 * warehouse — side-panel view switching (read-only navigation).
 *
 * `ui-side-panel.spec.ts` asserts the nav *groups* render and that 密钥管理
 * activates. This spec goes one level deeper: it clicks the three primary
 * read views a user switches between and asserts each one's distinctive
 * main-panel content — proving the SPA swaps views in place (no reload):
 *
 *   - 回收站   → recycle view (删除记录 summary)
 *   - 分享     → share view (分享链接 / 分享对象 segments)
 *   - 我的资料 → profile view (基础信息 card)
 *
 * Selectors verified against warehouse `web/src/views/home/Index.vue`.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { Wallet } from 'ethers';

import { seedAuthenticatedSession } from '../helpers/session';

function skipIfNoService() {
  test.skip(!baseURLFor('warehouse'), 'WAREHOUSE_BASE_URL not configured');
}

test(localizedTitle("【文件管理与导航界面 / UI】 侧面板在回收、共享和配置文件视图之间切换", "side-panel switches between recycle, share and profile views in place"), async ({
  page,
  baseURL,
  recorder,
}) => {
  skipIfNoService();
  const env = envFor('warehouse');
  test.skip(!env['WAREHOUSE_WALLET_PRIVATE_KEY'], 'WAREHOUSE_WALLET_PRIVATE_KEY not configured');

  const freshPk = Wallet.createRandom().privateKey;
  await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
  await seedAuthenticatedSession(page, baseURL!, freshPk);

  const sidePanel = page.locator('aside.side-panel');
  await expect(sidePanel).toBeVisible({ timeout: 15_000 });

  // --- 回收站 -------------------------------------------------------------
  await sidePanel.getByRole('button', { name: '回收站' }).click();
  await expect(page.locator('.section-title', { hasText: '回收站' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('删除记录')).toBeVisible();
  await recorder.step(page, '回收站视图');

  // --- 分享 ---------------------------------------------------------------
  await sidePanel.getByRole('button', { name: '分享', exact: true }).click();
  await expect(page.getByRole('button', { name: '分享链接', exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole('button', { name: '分享对象', exact: true })).toBeVisible();
  await recorder.step(page, '分享视图');

  // --- 我的资料 -----------------------------------------------------------
  await sidePanel.getByRole('button', { name: '我的资料' }).click();
  await expect(page.getByText('基础信息')).toBeVisible({ timeout: 10_000 });
  await recorder.step(page, '我的资料视图');

  // Never left the SPA (same origin, side panel still mounted).
  await expect(page).toHaveURL(baseURL! + '/');
  await expect(sidePanel).toBeVisible();
});
