/**
 * warehouse — UI cases that require the frontend dev server (WH-UI-009, WH-UI-012).
 *
 *   - WH-UI-009 上传大文件显示进度(分片上传): uploading a file at/over the
 *     resumable threshold (64 MiB, see RESUMABLE_UPLOAD_THRESHOLD in
 *     views/home/Index.vue) routes through the chunked upload-session flow. The
 *     header task panel (.task-button → .task-panel) then lists the upload as a
 *     .task-item carrying an .el-progress bar.
 *   - WH-UI-012 重命名文件/文件夹: upload a file, then rename it via the row ⋯
 *     menu → 重命名 dialog → 保存. The row shows the new name.
 *
 * Both drive the real browser UI on WAREHOUSE_BASE_URL (5173). When that dev
 * server is not reachable the cases skip cleanly (never faked) via
 * frontendReachable().
 *
 * Selectors verified against warehouse web/src/views/home/components/
 * FileTableView.vue (row ⋯ dropdown, `重命名` command), HomeOverlays.vue
 * (rename dialog: title 重命名, input placeholder 请输入新的名称, 保存 button)
 * and components/layout/AppHeader/Index.vue (.task-button popover → .task-panel
 * → UploadTaskListView .task-item / .el-progress).
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import type { Page } from '@playwright/test';
import { Wallet } from 'ethers';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { seedAuthenticatedSession } from '../helpers/session';
import { frontendReachable } from '../helpers/ui';

function rowByName(page: Page, name: string) {
  return page.locator('.el-table__row', { hasText: name });
}
async function rowMenuAction(page: Page, name: string, itemText: string) {
  const row = rowByName(page, name);
  await row.locator('.actions .el-button').last().click();
  await page.locator('.el-dropdown-menu__item', { hasText: itemText }).last().click();
}

async function gate() {
  test.skip(!baseURLFor('warehouse'), 'WAREHOUSE_BASE_URL not configured');
  test.skip(
    !envFor('warehouse')['WAREHOUSE_WALLET_PRIVATE_KEY'],
    'WAREHOUSE_WALLET_PRIVATE_KEY not configured',
  );
  const reachable = await frontendReachable(baseURLFor('warehouse'));
  test.skip(!reachable, 'warehouse frontend (5173) not reachable');
}

test(localizedTitle("【文件管理 UI / UI】 WH-UI-009 上传大文件显示进度(分片上传)", "WH-UI-009 uploading a large file shows chunked-upload progress"), async ({
  page,
  baseURL,
  recorder,
}) => {
  await gate();

  const ts = Date.now();
  const fileName = `e2e-large-${ts}.bin`;
  // At/above RESUMABLE_UPLOAD_THRESHOLD (64 MiB) the UI uses the chunked
  // upload-session path. 66 MiB clears the threshold with margin.
  const bytes = 66 * 1024 * 1024;

  await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
  await seedAuthenticatedSession(page, baseURL!, Wallet.createRandom().privateKey);
  await expect(page.locator('.action-cluster').first()).toBeVisible({ timeout: 15_000 });
  // Wait for the /personal listing to load (a fresh space ships a default guide
  // file) so the app is ready to accept an upload into the current directory.
  await expect(page.locator('.el-table__row').first()).toBeVisible({ timeout: 15_000 });
  await recorder.step(page, '进入个人资产文件视图');

  // Playwright caps in-memory upload buffers at 50 MiB, so the large file must
  // live on disk and be handed to the input by path.
  const dir = await mkdtemp(join(tmpdir(), 'wh-large-'));
  const filePath = join(dir, fileName);
  await writeFile(filePath, Buffer.alloc(bytes, 7));

  try {
    const fileInput = page.locator('input[type=file]:not([webkitdirectory])').first();
    await fileInput.setInputFiles(filePath);
    await recorder.step(page, '选择大文件上传');

    // Open the header task panel and confirm the chunked upload is tracked with
    // a progress bar.
    await page.locator('.right .task-button').click();
    const panel = page.locator('.task-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    const taskItem = panel.locator('.task-item', { hasText: fileName });
    await expect(taskItem).toBeVisible({ timeout: 20_000 });
    await expect(taskItem.locator('.el-progress')).toBeVisible({ timeout: 20_000 });
    await recorder.step(page, '任务面板显示分片上传进度');

    // Let the chunked upload finish so the file lands in the table.
    await expect(rowByName(page, fileName).first()).toBeVisible({ timeout: 120_000 });
    await recorder.step(page, '大文件上传完成');
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    await page
      .evaluate(async (file) => {
        const g = globalThis as any;
        const token = g.localStorage.getItem('authToken') || '';
        await g
          .fetch(`${g.location.origin}/dav/personal/${encodeURIComponent(file)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          })
          .catch(() => {});
      }, fileName)
      .catch(() => {});
  }
});

test(localizedTitle("【文件管理 UI / UI】 WH-UI-012 重命名文件/文件夹", "WH-UI-012 rename a file via the row menu dialog"), async ({ page, baseURL, recorder }) => {
  await gate();

  const ts = Date.now();
  const fileName = `e2e-rename-src-${ts}.txt`;
  const renamed = `e2e-rename-dst-${ts}.txt`;

  await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
  await seedAuthenticatedSession(page, baseURL!, Wallet.createRandom().privateKey);
  await expect(page.locator('.action-cluster').first()).toBeVisible({ timeout: 15_000 });
  // Wait for the /personal listing to load (a fresh space ships a default guide
  // file) so the app is ready to accept an upload into the current directory.
  await expect(page.locator('.el-table__row').first()).toBeVisible({ timeout: 15_000 });

  try {
    // seed a file to rename
    const fileInput = page.locator('input[type=file]:not([webkitdirectory])').first();
    await fileInput.setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(`rename me ${ts}`),
    });
    await expect(rowByName(page, fileName).locator('.file-name .name')).toBeVisible({
      timeout: 20_000,
    });
    await recorder.step(page, `上传待重命名文件 ${fileName}`);

    // ⋯ → 重命名 → dialog
    await rowMenuAction(page, fileName, '重命名');
    const input = page.getByPlaceholder('请输入新的名称');
    await input.waitFor({ state: 'visible', timeout: 10_000 });
    await input.fill(renamed);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await recorder.step(page, `重命名为 ${renamed}`);

    // the row now shows the new name and the old one is gone
    await expect(rowByName(page, renamed).locator('.file-name .name')).toBeVisible({
      timeout: 15_000,
    });
    await expect(rowByName(page, fileName)).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await page
      .evaluate(
        async ({ a, b }) => {
          const g = globalThis as any;
          const token = g.localStorage.getItem('authToken') || '';
          const headers = { Authorization: `Bearer ${token}` };
          const base = `${g.location.origin}/dav/personal`;
          await Promise.allSettled([
            g.fetch(`${base}/${encodeURIComponent(a)}`, { method: 'DELETE', headers }),
            g.fetch(`${base}/${encodeURIComponent(b)}`, { method: 'DELETE', headers }),
          ]);
        },
        { a: fileName, b: renamed },
      )
      .catch(() => {});
  }
});
