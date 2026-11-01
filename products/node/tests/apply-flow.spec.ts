/**
 * node — developer UI flow covering edit-draft and the open-by-default market.
 *
 * Both flows are real end-to-end (real SIWE login → seeded session → real
 * signed-action network calls through the UI → assertion on API results),
 * driven through a fresh throwaway wallet per run.
 *
 * Covers:
 *   - ND-E2E-002 edit a draft application & persist via application_update
 *   - ND-E2E-005 published applications do not require a usage request
 *
 * Selectors verified against node `web/src/views/apply/ApplyEdit.vue`,
 * `views/components/MarketBlock.vue`, and `views/components/ApplicationListTable.vue`.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { Wallet, getAddress, type BaseWallet } from 'ethers';

import { seedWalletSession } from '../helpers/session';
import { injectWallet } from '../helpers/wallet';
import { apiContext } from '../../../shared/api';
import { loginWithWallet } from '../helpers/auth';
import { buildCreateApplicationBody, deleteBody } from '../helpers/signedAction';

function skipIfNoService() {
  test.skip(!baseURLFor('node'), 'NODE_BASE_URL not configured');
}

/**
 * Pre-create a draft application against `baseURL` for `wallet` and return its
 * uid. The UI test then navigates to the edit page to exercise the update
 * path; this avoids scraping the create flow twice in one test.
 */
async function precreateDraft(
  baseURL: string,
  wallet: BaseWallet,
  address: string,
): Promise<string> {
  const tokens = await loginWithWallet(baseURL, wallet.privateKey);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${tokens.token}` });
  try {
    const create = await buildCreateApplicationBody(wallet, address);
    const res = await ctx.post('/api/v1/public/applications', { data: create.body });
    expect(res.status(), await res.text().catch(() => '')).toBe(200);
    const uid = ((await res.json()) as { data: { uid: string } }).data.uid;
    expect(uid).toBeTruthy();
    return uid;
  } finally {
    await ctx.dispose();
  }
}

test(localizedTitle("【开发者应用生命周期 / E2E】 ND-E2E-002 编辑草稿并保存持久化", "ND-E2E-002 edit a draft application and persist via application_update"), async ({
  page,
  recorder,
}) => {
  skipIfNoService();
  const env = envFor('node');
  test.skip(!env['NODE_WALLET_PRIVATE_KEY'], 'NODE_WALLET_PRIVATE_KEY not configured');
  const baseURL = baseURLFor('node')!;

  const wallet = Wallet.createRandom();
  const address = getAddress(wallet.address);
  const uid = await precreateDraft(baseURL, wallet, address);

  try {
    await injectWallet(page, wallet.privateKey);
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await seedWalletSession(page, baseURL, wallet.privateKey);

    await page.goto(`${baseURL}/market/dev/apply-edit?uid=${uid}`, {
      waitUntil: 'domcontentloaded',
    });
    // Edit-mode reveal: save button text flips from 保存草稿 to 保存修改
    // (key `app_edit_save_edit`). The create flow's name placeholder also
    // gets prefilled with the seeded value.
    const saveButton = page.getByRole('button', { name: '保存修改' });
    await expect(saveButton).toBeVisible({ timeout: 15_000 });
    await recorder.step(page, '编辑页加载（保存修改按钮）');

    const newName = `e2e-app-edit-${Date.now()}`;
    const newDesc = '已编辑：e2e 自动化修改描述';
    const nameInput = page.getByPlaceholder('例如：聊天应用 / 网关应用 / 仓储应用');
    await nameInput.fill(newName);
    await page
      .getByPlaceholder('面向谁、解决什么问题、主要能力是什么')
      .fill(newDesc);
    // 应用来源 (codePackagePath) is a required field and the draft leaves it
    // empty; fill it so form validation passes and the update fires.
    await page
      .getByPlaceholder('例如：../chat 或 https://github.com/xxx/xxx')
      .fill('../e2e-app-edited');

    // Watch for the application_update call only — save → PATCH, not POST.
    const [patchRes] = await Promise.all([
      page.waitForResponse(
        r =>
          new URL(r.url()).pathname === `/api/v1/public/applications/${uid}` &&
          r.request().method() === 'PATCH',
        { timeout: 30_000 },
      ),
      saveButton.click(),
    ]);
    expect(patchRes.status()).toBe(200);
    await recorder.step(page, '已触发 application_update');

    // Success toast (app_edit_save_updated) — match the partial string since
    // Element Plus adds a closing period.
    await expect(page.getByText(/应用修改已保存/)).toBeVisible({ timeout: 10_000 });
    await recorder.step(page, '保存修改成功提示');

    // Persisted: API returns the new name/description.
    const tokens = await loginWithWallet(baseURL, wallet.privateKey);
    const ctx = await apiContext(baseURL, { Authorization: `Bearer ${tokens.token}` });
    try {
      const detailRes = await ctx.get(`/api/v1/public/applications/${uid}`);
      expect(detailRes.status()).toBe(200);
      const detail = (await detailRes.json()) as {
        data: { name: string; description: string };
      };
      expect(detail.data.name).toBe(newName);
      expect(detail.data.description).toBe(newDesc);
    } finally {
      await ctx.dispose();
    }
  } finally {
    // Clean up the draft (best-effort; reuse the original wallet via API).
    const tokens = await loginWithWallet(baseURL, wallet.privateKey);
    const ctx = await apiContext(baseURL, { Authorization: `Bearer ${tokens.token}` });
    try {
      await ctx.delete(`/api/v1/public/applications/${uid}`, {
        data: await deleteBody(wallet, address, uid),
      });
    } finally {
      await ctx.dispose();
    }
  }
});

test(localizedTitle("【应用市场 / E2E】 ND-E2E-005 已发布应用无需申请即可使用", "ND-E2E-005 published applications are open by default"), async ({ page, recorder }) => {
  skipIfNoService();
  const env = envFor('node');
  test.skip(!env['NODE_WALLET_PRIVATE_KEY'], 'NODE_WALLET_PRIVATE_KEY not configured');
  const baseURL = baseURLFor('node')!;

  const wallet = Wallet.createRandom();

  await injectWallet(page, wallet.privateKey);
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await seedWalletSession(page, baseURL, wallet.privateKey);

  await page.goto(`${baseURL}/market`, { waitUntil: 'domcontentloaded' });
  const cards = page.locator('.tab.tab-market-clickable');
  await expect(cards.first()).toBeVisible({ timeout: 15_000 });
  // Published apps are directly usable from the market card. The old
  // global "申请使用" action is intentionally absent; historical request
  // records remain available from the request-history tab, but no new
  // request can be started from the public market.
  await expect(cards.first().getByText('申请使用', { exact: true })).toHaveCount(0);
  await expect(cards.first()).toHaveClass(/tab-market-clickable/);
  await recorder.step(page, '已发布应用默认点击即用且无申请入口');
});
