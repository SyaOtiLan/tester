/**
 * warehouse — file-view UI edges (WH-UI-010, WH-UI-011, WH-UI-013).
 *
 *   - WH-UI-010 文件预览对话框: open a text file's ⋯ → 预览; the preview dialog
 *     (.file-preview-dialog) opens and its editor (.preview-textarea) shows the
 *     file's content.
 *   - WH-UI-011 文件表视图/排序切换: clicking the sortable 名称 column header
 *     reorders the file table (ascending → descending).
 *   - WH-UI-013 上传重名文件的冲突处理: re-uploading a file with an existing name
 *     overwrites it in place — the table keeps a single row for that name (no
 *     duplicate), and the content reflects the latest upload.
 *
 * Drives the real browser UI on WAREHOUSE_BASE_URL (5173); skips cleanly (never
 * faked) when unreachable. A fresh random wallet gives each run an empty
 * /personal space so row ordering and counts are deterministic.
 *
 * Selectors verified against warehouse web/src/views/home/components/
 * FileTableView.vue (sortable el-table-column prop="name", ⋯ dropdown `预览`
 * command) and components/FilePreviewDialog.vue (class file-preview-dialog,
 * .preview-textarea for text mode).
 */
import { test, expect, baseURLFor, envFor } from '../fixtures';
import type { Page } from '@playwright/test';
import { Wallet } from 'ethers';

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
  test.skip(
    !(await frontendReachable(baseURLFor('warehouse'))),
    'warehouse frontend (5173) not reachable',
  );
}
async function enterFiles(page: Page, baseURL: string) {
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await seedAuthenticatedSession(page, baseURL, Wallet.createRandom().privateKey);
  await expect(page.locator('.action-cluster').first()).toBeVisible({ timeout: 15_000 });
  // Wait for the /personal listing to load (a fresh space ships a default guide
  // file) so the app is ready to accept uploads into the current directory.
  await expect(page.locator('.el-table__row').first()).toBeVisible({ timeout: 15_000 });
}
async function cleanup(page: Page, names: string[]) {
  await page
    .evaluate(async (files: string[]) => {
      const g = globalThis as any;
      const token = g.localStorage.getItem('authToken') || '';
      const headers = { Authorization: `Bearer ${token}` };
      const base = `${g.location.origin}/dav/personal`;
      await Promise.allSettled(
        files.map((f) => g.fetch(`${base}/${encodeURIComponent(f)}`, { method: 'DELETE', headers })),
      );
    }, names)
    .catch(() => {});
}

test("【文件管理 UI / UI】 WH-UI-010 文件预览对话框", async ({ page, baseURL, recorder }) => {
  await gate();
  const ts = Date.now();
  const fileName = `e2e-preview-${ts}.txt`;
  const marker = `preview-marker-${ts}`;

  await enterFiles(page, baseURL!);
  try {
    const fileInput = page.locator('input[type=file]:not([webkitdirectory])').first();
    await fileInput.setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(`hello ${marker}`),
    });
    await expect(rowByName(page, fileName).locator('.file-name .name')).toBeVisible({
      timeout: 20_000,
    });
    await recorder.step(page, `上传文件 ${fileName}`);

    await rowMenuAction(page, fileName, '预览');
    const dialog = page.locator('.file-preview-dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    // text preview renders an editable textarea seeded with the file content.
    await expect(dialog.locator('.preview-textarea textarea')).toHaveValue(new RegExp(marker), {
      timeout: 15_000,
    });
    await recorder.step(page, '文件预览对话框显示内容');
  } finally {
    await cleanup(page, [fileName]);
  }
});

test("【文件管理 UI / UI】 WH-UI-011 文件表视图/排序切换", async ({ page, baseURL, recorder }) => {
  await gate();
  const ts = Date.now();
  const names = [`e2e-sort-a-${ts}.txt`, `e2e-sort-b-${ts}.txt`, `e2e-sort-c-${ts}.txt`];

  await enterFiles(page, baseURL!);
  try {
    const fileInput = page.locator('input[type=file]:not([webkitdirectory])').first();
    await fileInput.setInputFiles(
      names.map((name) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(name) })),
    );
    for (const name of names) {
      await expect(rowByName(page, name).locator('.file-name .name')).toBeVisible({
        timeout: 20_000,
      });
    }
    await recorder.step(page, '上传三个文件');

    // The row positions of OUR three files (a new /personal also ships a
    // default user-guide file, so we compare relative order, not absolute rows).
    const orderOfOurFiles = async (): Promise<string[]> => {
      const all = await page.locator('.el-table__row .file-name .name').allInnerTexts();
      return all.filter((n) => names.includes(n));
    };

    // Click the sortable 名称 header. Element Plus cycles unsorted → asc → desc.
    const nameHeader = page.locator('.el-table__header-wrapper th', { hasText: '名称' }).first();
    await nameHeader.locator('.cell').click();
    await expect(nameHeader).toHaveClass(/ascending/, { timeout: 10_000 });
    await expect
      .poll(orderOfOurFiles, { timeout: 10_000 })
      .toEqual([names[0], names[1], names[2]]);
    await recorder.step(page, '按名称升序排序');

    await nameHeader.locator('.cell').click();
    await expect(nameHeader).toHaveClass(/descending/, { timeout: 10_000 });
    await expect
      .poll(orderOfOurFiles, { timeout: 10_000 })
      .toEqual([names[2], names[1], names[0]]);
    await recorder.step(page, '按名称降序排序');
  } finally {
    await cleanup(page, names);
  }
});

test("【文件管理 UI / UI】 WH-UI-013 上传重名文件的冲突处理", async ({
  page,
  baseURL,
  recorder,
}) => {
  await gate();
  const ts = Date.now();
  const fileName = `e2e-conflict-${ts}.txt`;

  await enterFiles(page, baseURL!);
  try {
    const fileInput = page.locator('input[type=file]:not([webkitdirectory])').first();

    // first upload
    await fileInput.setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(`v1-${ts}`),
    });
    await expect(rowByName(page, fileName).locator('.file-name .name')).toBeVisible({
      timeout: 20_000,
    });
    await recorder.step(page, '首次上传');

    // second upload, same name, different content
    await fileInput.setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(`v2-overwritten-${ts}`),
    });
    // give the re-upload + listing refresh time to settle
    await expect(rowByName(page, fileName).locator('.file-name .name')).toBeVisible({
      timeout: 20_000,
    });
    await recorder.step(page, '同名再次上传');

    // conflict handling = overwrite in place: exactly one row for that name.
    await expect(rowByName(page, fileName)).toHaveCount(1, { timeout: 15_000 });

    // and the stored content is the latest upload.
    const content = await page.evaluate(async (file: string) => {
      const g = globalThis as any;
      const token = g.localStorage.getItem('authToken') || '';
      const res = await g.fetch(`${g.location.origin}/dav/personal/${encodeURIComponent(file)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.text();
    }, fileName);
    expect(content).toContain('v2-overwritten');
  } finally {
    await cleanup(page, [fileName]);
  }
});
