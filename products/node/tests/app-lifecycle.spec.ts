/**
 * node — developer application create → verify → delete loop (mutating flow).
 *
 * A fresh random wallet is used per run, so the my-created list starts empty
 * and each execution is naturally isolated: any residue lives under a
 * throwaway owner address that is never reused, so runs never accumulate.
 * The spec still deletes what it creates in-flow (that IS the delete
 * coverage).
 *
 * Every write here is signed via an injected wallet shim (no popup):
 *   - 保存草稿 → 2 personal_sign (client identity derivation + the
 *     `application_create` signed action envelope).
 *   - 删除     → 1 personal_sign (`application_delete`).
 * The SIWE session itself is seeded directly (JWT written to localStorage),
 * so no interactive login is needed. The optional icon upload is skipped —
 * it is the only part of this view that would need the UCAN/WebDAV path.
 *
 * Flow:
 *   1. Seed session + inject signer, open /market/dev/apply-edit.
 *   2. Fill name/description/location/source + pick a category.
 *   3. 保存草稿 → POST /api/v1/public/applications; redirect to my-apps.
 *   4. Assert the draft row appears under 我创建的.
 *   5. Delete it via the row's 删除 → popconfirm 确定; row disappears.
 *
 * Selectors verified against node `web/src/views/apply/ApplyEdit.vue`,
 * `ApplyView.vue`, and `views/components/ApplicationListTable.vue`.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { Wallet } from 'ethers';

import { seedWalletSession } from '../helpers/session';
import { injectWallet } from '../helpers/wallet';

function skipIfNoService() {
  test.skip(!baseURLFor('node'), 'NODE_BASE_URL not configured');
}

test(localizedTitle("【应用市场与应用生命周期 / API】 创建草稿应用程序，在我创建的中查看它，然后将其删除", "create a draft application, see it in 我创建的, then delete it"), async ({
  page,
  recorder,
}) => {
  skipIfNoService();
  const env = envFor('node');
  test.skip(!env['NODE_WALLET_PRIVATE_KEY'], 'NODE_WALLET_PRIVATE_KEY not configured');
  const baseURL = baseURLFor('node')!;

  const ts = Date.now();
  const appName = `e2e-app-${ts}`;

  // Fresh throwaway wallet: empty my-created space, isolated residue.
  const freshPk = Wallet.createRandom().privateKey;
  await injectWallet(page, freshPk);

  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await seedWalletSession(page, baseURL, freshPk);

  await page.goto(`${baseURL}/market/dev/apply-edit`, { waitUntil: 'domcontentloaded' });

  // --- Fill the required fields (by placeholder — labels aren't wired) -----
  await page
    .getByPlaceholder('例如：聊天应用 / 网关应用 / 仓储应用')
    .fill(appName);
  await page
    .getByPlaceholder('面向谁、解决什么问题、主要能力是什么')
    .fill('e2e 自动化草稿，用于验证建应用链路');
  await page
    .getByPlaceholder('例如：http://localhost:3020', { exact: true })
    .fill('http://localhost:3020');
  await page.getByPlaceholder('例如：../chat 或 https://github.com/xxx/xxx').fill('../e2e-app');

  // Category is an allow-create el-select (its placeholder is not a DOM input
  // attribute), so drive it via its form-item: open, type, confirm.
  const categoryItem = page.locator('.el-form-item', { hasText: '应用分类' });
  await categoryItem.locator('.el-select').click();
  const categoryInput = categoryItem.locator('input').last();
  await categoryInput.fill('assistant');
  await categoryInput.press('Enter');
  await recorder.step(page, `填写建应用表单 ${appName}`);

  // --- Save draft → signed create -----------------------------------------
  // Save draft fires a duplicate-name-check search (POST .../applications/search)
  // BEFORE the create, so match the exact create pathname only.
  const [createRes] = await Promise.all([
    page.waitForResponse(
      r =>
        new URL(r.url()).pathname === '/api/v1/public/applications' &&
        r.request().method() === 'POST',
      { timeout: 30_000 },
    ),
    page.getByRole('button', { name: '保存草稿' }).click(),
  ]);
  const createBody = (await createRes.json()) as { code?: number; data?: { uid?: string } };
  expect(createBody.code).toBe(0);
  expect(createBody.data?.uid).toBeTruthy();
  await recorder.step(page, '保存草稿（已签名建应用）');

  // --- Lands in 我创建的 with the new row ---------------------------------
  // Both my-apps tabs keep their tables in the DOM; the inactive pane is
  // display:none, so scope to the visible (我创建的) table.
  await expect(page).toHaveURL(/\/market\/dev\/my-apps/, { timeout: 15_000 });
  const row = page
    .locator('.el-table__row:visible', {
      has: page.locator('.name-cell .title', { hasText: appName }),
    })
    .first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await recorder.step(page, '应用出现在「我创建的」');

  // --- Delete via the row action → popconfirm -----------------------------
  await row.getByRole('button', { name: '删除' }).click();
  // el-popconfirm confirm button text is 确 定 (spaced); match tolerant.
  await page.getByRole('button', { name: /确\s*定/ }).click();
  await expect(row).toHaveCount(0, { timeout: 15_000 });
  await recorder.step(page, '删除草稿应用');
});
