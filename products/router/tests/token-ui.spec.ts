/**
 * router — token-row interactions & the token edit page (RT-UI-022 / RT-UI-023).
 *
 * Both require the account to already hold at least one token. Minting a token
 * needs available models (a purchase — the external-payment boundary this suite
 * does not cross), so when the account has no token these cannot be exercised
 * and skip cleanly after a live probe of GET /token/. When a token exists the
 * full interaction runs.
 *
 * Selectors verified against router web/src/components/TokensTable.jsx and
 * web/src/pages/Token/EditToken.jsx.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';
import { acquireRouterToken } from '../helpers/auth';
import { seedWalletSession } from '../helpers/session';

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}
function skipIfNoKey() {
  test.skip(
    !envFor('router')['ROUTER_WALLET_PRIVATE_KEY'],
    'ROUTER_WALLET_PRIVATE_KEY not configured',
  );
}

async function firstToken(baseURL: string): Promise<{ id?: string | number; name?: string } | undefined> {
  const { token } = await acquireRouterToken(baseURL);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    const body = (await (await ctx.get('/api/v1/public/token/')).json()) as {
      data?: Array<{ id?: string | number; name?: string }>;
    };
    return (body.data ?? [])[0];
  } finally {
    await ctx.dispose();
  }
}

/**
 * Mint a dedicated token via the user API (entitlement-gated: the account must have
 * available models). Returns the trimmed id plus the owner ctx (kept open for
 * cleanup), or null when the account cannot mint (payment boundary). Using a
 * dedicated token keeps the edit test isolated from concurrent token specs that
 * create/delete rows on the same shared account.
 */
async function mintOwnToken(
  baseURL: string,
  name: string,
): Promise<{ id: string; ctx: Awaited<ReturnType<typeof apiContext>> } | null> {
  const { token } = await acquireRouterToken(baseURL);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  const res = (await (
    await ctx.post('/api/v1/public/token/', {
      data: { name, unlimited_quota: true, unlimited_request_count: true, expired_time: -1, models: '' },
    })
  ).json()) as { success?: boolean; data?: { id?: string | number } };
  if (!res.success || res.data?.id == null) {
    await ctx.dispose();
    return null;
  }
  return { id: String(res.data.id).trim(), ctx };
}

// RT-UI-022 (P2)
test(localizedTitle("【令牌、充值与余额 / API】 令牌行支持复制和启用/禁用切换", "token row supports copy and enable/disable toggle"), async ({ page, baseURL, recorder }) => {
  skipIfNoService();
  skipIfNoKey();
  const existing = await firstToken(baseURL!);
  test.skip(
    !existing?.id,
    'account has no token; minting one needs purchased models (payment boundary), ' +
      'so the token-row copy/toggle interaction cannot be exercised',
  );

  await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
  await seedWalletSession(page, baseURL!, envFor('router')['ROUTER_WALLET_PRIVATE_KEY']!);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.goto(`${baseURL}/workspace/token`, { waitUntil: 'domcontentloaded' });

  const table = page.locator('.router-list-table');
  await expect(table).toBeVisible({ timeout: 15_000 });

  // Copy the token key → success toast appears.
  await page.locator('.router-icon-button').first().click();
  await expect(page.getByText(/复制成功|copied|Copied|copy/i).first()).toBeVisible({ timeout: 10_000 });
  await recorder.step(page, '令牌复制成功');

  // Toggle the status switch → the PUT (?status_only=true) fires and settles.
  const sw = page.locator('.router-token-status-switch').first();
  await expect(sw).toBeVisible();
  const [putRes] = await Promise.all([
    page.waitForResponse(
      r => r.url().includes('/api/v1/public/token/') && r.request().method() === 'PUT',
      { timeout: 15_000 },
    ),
    sw.click(),
  ]);
  expect(putRes.ok()).toBe(true);
  await recorder.step(page, '令牌状态切换');

  // Flip it back so the run is side-effect neutral.
  await sw.click().catch(() => {});
});

// RT-UI-023 (P2)
test(localizedTitle("【令牌、充值与余额 / UI】 令牌编辑页面保存名称更改", "the token edit page saves name changes"), async ({ page, baseURL, recorder }) => {
  skipIfNoService();
  skipIfNoKey();
  // Mint a DEDICATED token to edit: the account is shared across token specs via
  // ROUTER_WALLET_PRIVATE_KEY, so editing firstToken() races concurrent specs that
  // delete rows (the edit page then re-renders/detaches mid-interaction).
  const owned = await mintOwnToken(baseURL!, `e2e-uiedit-${Date.now().toString(36)}`);
  test.skip(
    owned === null,
    'account cannot mint a token to edit (no available models — payment boundary)',
  );
  const { id, ctx } = owned!;

  try {
    await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
    await seedWalletSession(page, baseURL!, envFor('router')['ROUTER_WALLET_PRIVATE_KEY']!);
    await page.goto(`${baseURL}/workspace/token/${id}`, { waitUntil: 'domcontentloaded' });

    // The detail page (EditToken.jsx isDetailMode) opens read-only, split into
    // sections, and loads the token async — loadToken + loadAvailableModels each
    // re-render the basic section, so the edit button can detach mid-click. Wait for
    // the name field to render, then retry the "enter edit mode" step as a unit until
    // the field is actually editable.
    const nameInput = page.getByPlaceholder(/请输入名称|Please enter name/);
    await expect(nameInput).toBeVisible({ timeout: 15_000 });
    await expect(async () => {
      // token.buttons.edit (zh 编辑 / en Edit) switches the basic section into edit mode.
      await page.getByRole('button', { name: /^编辑$|^Edit$/ }).first().click();
      await expect(nameInput).toBeEditable({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    const newName = `e2e-ui-edit-${Date.now()}`;
    await nameInput.fill(newName);

    const [putRes] = await Promise.all([
      page.waitForResponse(
        r => r.url().includes('/api/v1/public/token/') && r.request().method() === 'PUT',
        { timeout: 15_000 },
      ),
      // Save = token.edit.buttons.submit (zh 确认 / en Confirm).
      page.getByRole('button', { name: /^确认$|^Confirm$/ }).first().click(),
    ]);
    const putBody = (await putRes.json()) as { success?: boolean };
    expect(putBody.success).toBe(true);
    await recorder.step(page, '令牌编辑保存');
  } finally {
    // Dedicated token — just remove it; no original state to restore.
    await ctx.delete(`/api/v1/public/token/${id}/`).catch(() => {});
    await ctx.dispose();
  }
});
