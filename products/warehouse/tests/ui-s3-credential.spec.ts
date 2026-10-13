/**
 * warehouse — S3 credential creation through the real UI (mutating flow).
 *
 * A fresh random wallet is seeded per run, so each execution starts from a
 * brand-new user with zero credentials — naturally idempotent. The spec
 * creates one S3 credential end-to-end (the create-coverage) and a
 * best-effort `finally` revokes + deletes any residue via the same API the
 * UI calls, so a mid-flow failure never leaves a dangling credential.
 *
 * Flow (密钥管理 → S3 凭证 tab → 新建 → 创建凭证):
 *   1. Open 密钥管理 and switch to the S3 凭证 tab.
 *   2. 新建 → fill 凭证名称 `e2e-s3-<ts>` (bucket defaults to personal).
 *   3. 创建凭证 → the one-time reveal block shows Access Key ID + Secret.
 *   4. Close → the new credential row appears in the S3 table.
 *
 * Selectors verified against warehouse `web/src/views/home/Index.vue`
 * (S3 tab-pane `name="s3"` → `#pane-s3`; dialog title `新建 S3 凭证`;
 * name input placeholder `例如：本地 mc`; reveal rows `.access-key-created-row`)
 * and `web/src/api/index.ts` `s3CredentialApi` (create/list/revoke/delete
 * under `/api/v1/public/s3/credentials/*`).
 */
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { Wallet } from 'ethers';

import { seedAuthenticatedSession } from '../helpers/session';

function skipIfNoService() {
  test.skip(!baseURLFor('warehouse'), 'WAREHOUSE_BASE_URL not configured');
}

test("【文件管理与导航界面 / UI】 创建 S3 凭证并公开其访问密钥 ID + Secret", async ({
  page,
  baseURL,
  recorder,
}) => {
  skipIfNoService();
  const env = envFor('warehouse');
  test.skip(!env['WAREHOUSE_WALLET_PRIVATE_KEY'], 'WAREHOUSE_WALLET_PRIVATE_KEY not configured');

  const ts = Date.now();
  const credName = `e2e-s3-${ts}`;

  const freshPk = Wallet.createRandom().privateKey;
  await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
  await seedAuthenticatedSession(page, baseURL!, freshPk);

  const sidePanel = page.locator('aside.side-panel');
  await expect(sidePanel).toBeVisible({ timeout: 15_000 });

  try {
    // --- Enter 密钥管理 → S3 凭证 tab -------------------------------------
    await sidePanel.getByRole('button', { name: '密钥管理' }).click();
    await page.getByRole('tab', { name: 'S3 凭证' }).click();
    // The S3 tab-pane (name="s3") renders as #pane-s3; scope actions to it so
    // the sibling WebDAV pane's identical 新建 button never matches.
    const s3Pane = page.locator('#pane-s3');
    await expect(s3Pane).toBeVisible({ timeout: 10_000 });
    await recorder.step(page, '密钥管理 · S3 凭证');

    // --- 新建 → fill the create dialog -----------------------------------
    await s3Pane.getByRole('button', { name: '新建' }).click();
    const dialog = page.locator('.el-dialog', { hasText: '新建 S3 凭证' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByPlaceholder('例如：本地 mc').fill(credName);
    await recorder.step(page, `填写凭证名称 ${credName}`);

    // --- 创建凭证 → one-time reveal --------------------------------------
    await dialog.getByRole('button', { name: '创建凭证' }).click();
    const reveal = dialog.locator('.access-key-created');
    await expect(reveal).toBeVisible({ timeout: 15_000 });

    // Access Key ID + Secret rows both carry a non-empty .mono value.
    const idRow = reveal.locator('.access-key-created-row', { hasText: 'Access Key ID' });
    const secretRow = reveal.locator('.access-key-created-row', { hasText: 'Secret' });
    await expect(idRow.locator('.mono')).not.toHaveText('');
    await expect(secretRow.locator('.mono')).not.toHaveText('');
    await recorder.step(page, '凭证创建成功（Access Key ID / Secret）');

    // --- Close → the credential appears in the S3 table ------------------
    await dialog.getByRole('button', { name: '关闭' }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(s3Pane.locator('.el-table__row', { hasText: credName })).toBeVisible({
      timeout: 10_000,
    });
    await recorder.step(page, 'S3 凭证列表出现新行');
  } finally {
    // Best-effort cleanup: revoke then delete every credential on this fresh
    // user via the same endpoints the UI calls. A fresh wallet already
    // guarantees isolation, so failures here are noise.
    await page
      .evaluate(async () => {
        const g = globalThis as any;
        const token = g.localStorage.getItem('authToken') || '';
        const headers = {
          'Content-Type': 'application/json',
          accept: 'application/json',
          Authorization: `Bearer ${token}`,
        };
        const base = `${g.location.origin}/api/v1/public/s3/credentials`;
        try {
          const res = await g.fetch(`${base}/list`, { headers });
          const body = await res.json();
          const items = (body?.items || body?.data?.items || []) as Array<{
            id: string;
            status?: string;
          }>;
          for (const item of items) {
            await g
              .fetch(`${base}/revoke`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ id: item.id }),
              })
              .catch(() => {});
            await g
              .fetch(`${base}/delete`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ id: item.id }),
              })
              .catch(() => {});
          }
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
  }
});
