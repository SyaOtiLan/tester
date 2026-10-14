/**
 * warehouse — file management main journey through the real UI.
 *
 * A fresh random wallet is seeded per run (via the SIWE session helper), so
 * each execution starts from a brand-new, empty `/personal` asset space —
 * the run is naturally idempotent and needs no cross-run cleanup. The spec
 * still deletes what it creates in-flow (that IS the delete-coverage), and a
 * best-effort `finally` removes any residue if an assertion fails midway.
 *
 * One serial journey (order matters — each step builds on the last):
 *   1. Create a folder `e2e-<ts>`         → row appears in the file table.
 *   2. Upload a file `e2e-file-<ts>.txt`  → row appears.
 *   3. Download it                        → browser download event + name.
 *   4. Delete the file (⋯ → 删除 → 确定)  → row disappears.
 *   5. Delete the folder                  → row disappears.
 *
 * Selectors verified against warehouse `web/src/views/home/Index.vue` +
 * `components/FileTableView.vue`. NB: toolbar buttons are icon-only
 * (tooltip-labeled), so folder-create is reached via the primary circle
 * button and uploads go straight to the hidden <input type=file>.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import type { Page } from '@playwright/test';
import { Wallet } from 'ethers';

import { seedAuthenticatedSession } from '../helpers/session';

function skipIfNoService() {
  test.skip(!baseURLFor('warehouse'), 'WAREHOUSE_BASE_URL not configured');
}

/** Locate a file-table row by its visible name. */
function rowByName(page: Page, name: string) {
  return page.locator('.el-table__row', { hasText: name });
}

/** Open a row's overflow (⋯) menu and click the given item text. */
async function rowMenuAction(page: Page, name: string, itemText: string) {
  const row = rowByName(page, name);
  // The ⋯ trigger is the last icon button in the row's action cell.
  await row.locator('.actions .el-button').last().click();
  await page.locator('.el-dropdown-menu__item', { hasText: itemText }).last().click();
}

test(localizedTitle("【文件管理与导航界面 / E2E】 创建文件夹，上传，下载，然后通过文件 UI 删除", "create folder, upload, download, then delete via the file UI"), async ({
  page,
  baseURL,
  recorder,
}) => {
  skipIfNoService();
  const env = envFor('warehouse');
  test.skip(!env['WAREHOUSE_WALLET_PRIVATE_KEY'], 'WAREHOUSE_WALLET_PRIVATE_KEY not configured');

  const ts = Date.now();
  const folderName = `e2e-${ts}`;
  const fileName = `e2e-file-${ts}.txt`;
  const fileBody = `warehouse e2e upload ${ts}`;

  const freshPk = Wallet.createRandom().privateKey;
  await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
  await seedAuthenticatedSession(page, baseURL!, freshPk);

  // The default post-login view is the /personal file browser. Wait for its
  // toolbar (the icon-only action cluster) to mount.
  await expect(page.locator('.action-cluster').first()).toBeVisible({ timeout: 15_000 });
  await recorder.step(page, '进入个人资产文件视图');

  try {
    // --- 1) Create a folder -------------------------------------------------
    // First primary circle button in the toolbar = 新建文件夹.
    await page.locator('.action-cluster .el-button--primary').first().click();
    const folderInput = page.getByPlaceholder('请输入文件夹名称');
    await folderInput.waitFor({ state: 'visible', timeout: 10_000 });
    await folderInput.fill(folderName);
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(rowByName(page, folderName).locator('.file-name .name')).toBeVisible({
      timeout: 15_000,
    });
    await recorder.step(page, `新建文件夹 ${folderName}`);

    // --- 2) Upload a file ---------------------------------------------------
    // Only one non-directory file input is rendered at a time (v-if).
    const fileInput = page.locator('input[type=file]:not([webkitdirectory])').first();
    await fileInput.setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(fileBody),
    });
    await expect(rowByName(page, fileName).locator('.file-name .name')).toBeVisible({
      timeout: 20_000,
    });
    await recorder.step(page, `上传文件 ${fileName}`);

    // --- 3) Download the file ----------------------------------------------
    const fileRow = rowByName(page, fileName);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      // The inline download icon is the first link button in the row actions.
      fileRow.locator('.actions .el-button').first().click(),
    ]);
    expect(download.suggestedFilename()).toBe(fileName);
    await recorder.step(page, '下载文件');

    // --- 4) Delete the file ------------------------------------------------
    await rowMenuAction(page, fileName, '删除');
    const confirm = page.locator('.el-message-box');
    await confirm.waitFor({ state: 'visible', timeout: 10_000 });
    await confirm.getByRole('button', { name: '确定' }).click();
    await expect(rowByName(page, fileName)).toHaveCount(0, { timeout: 15_000 });
    await recorder.step(page, '删除文件');

    // --- 5) Delete the folder ----------------------------------------------
    await rowMenuAction(page, folderName, '删除');
    const confirm2 = page.locator('.el-message-box');
    await confirm2.waitFor({ state: 'visible', timeout: 10_000 });
    await confirm2.getByRole('button', { name: '确定' }).click();
    await expect(rowByName(page, folderName)).toHaveCount(0, { timeout: 15_000 });
    await recorder.step(page, '删除文件夹');
  } finally {
    // Best-effort residue cleanup if the flow aborted early. Uses the seeded
    // JWT against the WebDAV path the UI itself writes to (/dav/personal/...).
    // A fresh wallet already guarantees isolation, so failures here are noise.
    await page
      .evaluate(
        async ({ folder, file }) => {
          const g = globalThis as any;
          const token = g.localStorage.getItem('authToken') || '';
          const headers = { Authorization: `Bearer ${token}` };
          const base = `${g.location.origin}/dav/personal`;
          await Promise.allSettled([
            g.fetch(`${base}/${encodeURIComponent(file)}`, { method: 'DELETE', headers }),
            g.fetch(`${base}/${encodeURIComponent(folder)}/`, { method: 'DELETE', headers }),
          ]);
        },
        { folder: folderName, file: fileName },
      )
      .catch(() => {});
  }
});
