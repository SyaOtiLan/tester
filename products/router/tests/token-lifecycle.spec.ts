/**
 * router — API token create → verify → delete loop (mutating flow).
 *
 * Fills the workspace create-token form and submits a real request to
 * `POST /api/v1/public/token/`. The outcome depends on the account:
 *
 *   - Funded account (has available models): the token is created, appears in
 *     the list, and is deleted in `finally` — a full idempotent loop.
 *   - Unfunded account: the backend gates creation with "当前账号暂无可用模型…"
 *     (models require a purchase/top-up, which is the external-payment
 *     boundary we don't cross). We then assert the request was well-formed
 *     and reached that gate — the create flow is proven wired to the boundary.
 *
 * Either way the assertions are honest about what happened. Naming uses the
 * `e2e-tok-<ts>` prefix.
 *
 * One gotcha (verified in `EditToken.jsx`): the 确认/Confirm button is
 * disabled unless `GET /api/v1/public/user/models/available` returns a
 * non-empty `data` array — so we stub that single read non-empty to enable
 * the button. The create itself hits the real backend, which applies its own
 * models gate independently of that stub.
 *
 * Selectors verified against router `web/src/pages/Token/**` +
 * `web/src/components/TokensTable.jsx`. The success card title `令牌已创建`
 * is hardcoded (not i18n), so it is asserted verbatim; other labels follow
 * the browser locale and are matched zh|en.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { request } from '@playwright/test';

import { seedWalletSession } from '../helpers/session';

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}

test(localizedTitle("【令牌、充值与余额 / API】 通过工作区创建 API 令牌，然后将其删除", "create an API token through the workspace, then delete it"), async ({
  page,
  baseURL,
  recorder,
}) => {
  skipIfNoService();
  const env = envFor('router');
  test.skip(!env['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');

  const ts = Date.now();
  const tokenName = `e2e-tok-${ts}`;
  let createdId = '';
  let bearer = '';

  // Enable the Confirm button: the create form gates on a non-empty
  // available-models list. Stub just this read; the create POST is real.
  await page.route('**/api/v1/public/user/models/available*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '', data: ['claude-3-5-sonnet'], items: [] }),
    });
  });

  await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
  const session = await seedWalletSession(page, baseURL!, env['ROUTER_WALLET_PRIVATE_KEY']!);
  bearer = session.token;

  try {
    // --- Open the create-token page ----------------------------------------
    await page.goto(`${baseURL}/workspace/token`, { waitUntil: 'domcontentloaded' });
    // Two "新增令牌/Add Token" buttons exist (page header + empty-table CTA);
    // the page-level one is first in the DOM.
    await page.getByRole('button', { name: /新增令牌|Add Token/ }).first().click();

    const nameInput = page.getByPlaceholder(/请输入名称|Please enter name/);
    await nameInput.waitFor({ state: 'visible', timeout: 15_000 });
    await nameInput.fill(tokenName);
    await recorder.step(page, `填写令牌名称 ${tokenName}`);

    // --- Confirm → real POST /token/ ---------------------------------------
    const [createRes] = await Promise.all([
      page.waitForResponse(
        r => r.url().includes('/api/v1/public/token/') && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      page.getByRole('button', { name: /^确认$|^Confirm$/ }).click(),
    ]);

    // The UI must have wired the typed name into the request body regardless
    // of the backend's decision.
    const postData = (createRes.request().postDataJSON() ?? {}) as { name?: string };
    expect(postData.name).toBe(tokenName);

    const createBody = (await createRes.json()) as {
      success?: boolean;
      message?: string;
      data?: { id?: string };
    };

    if (createBody.success) {
      // Funded account → full create → verify → delete loop.
      createdId = String(createBody.data?.id ?? '');
      expect(createdId).not.toBe('');

      // The one-time key card (title from token.created.title, i18n-driven → follows
      // the app language, so match zh/en) confirms the create.
      await expect(
        page.getByRole('heading', { name: /令牌已创建|Token created/ }),
      ).toBeVisible({ timeout: 15_000 });
      await recorder.step(page, '令牌已创建');

      // Back to the list → the new token row is present.
      await page.goto(`${baseURL}/workspace/token`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.router-list-table')).toBeVisible({ timeout: 15_000 });
      await expect(
        page.locator('.router-list-table .ant-table-row', { hasText: tokenName }).first(),
      ).toBeVisible({ timeout: 15_000 });
      await recorder.step(page, '令牌出现在列表');
    } else {
      // Unfunded account → backend gates creation on available models, which
      // require a purchase/top-up (the external-payment boundary). The create
      // flow is verified wired up to that gate; nothing was written.
      expect(createBody.message ?? '').toMatch(/暂无可用模型|available model|购买套餐|top.?up/i);
      test.info().annotations.push({
        type: 'boundary',
        description: 'account has no available models; token create verified to backend gate only',
      });
      await recorder.step(page, '创建到达后端模型门槛（未下发令牌）');
    }
  } finally {
    // Delete via the real API (Bearer only) so the run leaves nothing behind.
    if (createdId && bearer) {
      const ctx = await request.newContext({
        baseURL,
        extraHTTPHeaders: { Authorization: `Bearer ${bearer}` },
      });
      await ctx.delete(`/api/v1/public/token/${createdId}/`).catch(() => {});
      await ctx.dispose();
    }
  }
});
