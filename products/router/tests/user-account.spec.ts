/**
 * router — personal centre & account settings.
 *
 *   - RT-API-041: the aggregate user read endpoints (dashboard, spend overview,
 *     quota summary, quota overview) all return well-formed data for a fresh
 *     wallet account. NOTE (contract discrepancy vs docs): the case doc claims
 *     these use the SDK `{code:0,...}` envelope, but — like the rest of
 *     `/user/*` (see authz.spec) — the live service returns the proto
 *     `{success,...}` envelope. Assertions reflect the live contract.
 *   - RT-UI-026 / RT-E2E-004 / RT-E2E-005: the account settings page renders the
 *     account info, and the username / password mutations round-trip.
 *
 * Verified against router `internal/admin/controller/user/*` + `web/src/pages`.
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

// RT-API-041 (P2)
test(localizedTitle("【个人中心与账户设置 / API】 RT-API-041 用户聚合读接口返回数据", "user aggregate read endpoints return well-formed data (RT-API-041)"), async () => {
  skipIfNoService();
  skipIfNoKey();
  const baseURL = baseURLFor('router')!;
  const { token } = await acquireRouterToken(baseURL);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    // /user/dashboard → proto envelope, data is an array (empty for a fresh account).
    const dash = (await (await ctx.get('/api/v1/public/user/dashboard')).json()) as {
      success?: boolean;
      data?: unknown;
    };
    expect(dash.success).toBe(true);
    expect(Array.isArray(dash.data)).toBe(true);

    // /user/spend/overview → period/today aggregates, zero-valued when unused.
    const spend = (await (await ctx.get('/api/v1/public/user/spend/overview')).json()) as {
      success?: boolean;
      data?: { period_days?: number; period_cost?: number; today_requests?: number };
    };
    expect(spend.success).toBe(true);
    expect(typeof spend.data?.period_days).toBe('number');
    expect(typeof spend.data?.period_cost).toBe('number');

    // /user/quota/summary → per-user daily quota block.
    const qs = (await (await ctx.get('/api/v1/public/user/quota/summary')).json()) as {
      success?: boolean;
      data?: { user_id?: string; daily?: { remaining_quota?: number } };
    };
    expect(qs.success).toBe(true);
    expect(qs.data?.user_id?.trim()).toBeTruthy();
    expect(typeof qs.data?.daily?.remaining_quota).toBe('number');

    // /user/quota/overview → package + balance breakdown.
    const qo = (await (await ctx.get('/api/v1/public/user/quota/overview')).json()) as {
      success?: boolean;
      data?: { total_amount?: number; balance?: { topup_balance_amount?: number } };
    };
    expect(qo.success).toBe(true);
    expect(typeof qo.data?.total_amount).toBe('number');
    expect(typeof qo.data?.balance?.topup_balance_amount).toBe('number');
  } finally {
    await ctx.dispose();
  }
});

// RT-UI-026 (P2) — the account settings page (PersonalSetting) renders the
// "账户信息" block with the (read-only) wallet address and the current username.
test(localizedTitle("【个人中心与账户设置 / UI】 RT-UI-026 账户设置页加载并展示账户信息", "the account setting page shows the account info (RT-UI-026)"), async ({
  page,
  baseURL,
  recorder,
}) => {
  skipIfNoService();
  skipIfNoKey();
  await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
  await seedWalletSession(page, baseURL!, envFor('router')['ROUTER_WALLET_PRIVATE_KEY']!);
  await page.goto(`${baseURL}/workspace/setting`, { waitUntil: 'domcontentloaded' });

  // The account-info section header + rows render.
  await expect(page.getByText(/账户信息|Account info/i).first()).toBeVisible({ timeout: 15_000 });

  // The wallet-address row is a read-only input pre-filled with the 0x address.
  const addrInput = page
    .locator('input.router-section-input[value^="0x"]')
    .first();
  await expect(addrInput).toBeVisible();
  expect((await addrInput.inputValue()).toLowerCase()).toMatch(/^0x[0-9a-f]{40}$/);

  // The username row carries the current username.
  const nameInput = page.locator('input[placeholder*="username" i]').first();
  await expect(nameInput).toBeVisible();
  expect((await nameInput.inputValue()).trim().length).toBeGreaterThan(0);

  // The change-password entry is present.
  await expect(page.getByRole('button', { name: /修改密码|Change password/i }).first()).toBeVisible();
  await recorder.step(page, '账户设置页展示账户信息');
});

// RT-E2E-004 (P2) — edit the username through the settings UI: 编辑 → fill →
// 保存 fires PUT /user/self and the new value persists across a reload. The
// original username is restored afterwards (via the same endpoint) so the run is
// side-effect neutral.
test(localizedTitle("【个人中心与账户设置 / E2E】 RT-E2E-004 修改用户名并持久化", "changing the username through the UI persists (RT-E2E-004)"), async ({
  page,
  baseURL,
  recorder,
}) => {
  skipIfNoService();
  skipIfNoKey();
  await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
  await seedWalletSession(page, baseURL!, envFor('router')['ROUTER_WALLET_PRIVATE_KEY']!);
  await page.goto(`${baseURL}/workspace/setting`, { waitUntil: 'domcontentloaded' });

  const nameInput = page.locator('input[placeholder*="username" i]').first();
  await expect(nameInput).toBeVisible({ timeout: 15_000 });
  const original = (await nameInput.inputValue()).trim();
  const newName = `e2e_${Date.now().toString(36).slice(-6)}`;

  try {
    // Enter edit mode (the input is read-only until 编辑/Edit is clicked).
    await page.getByRole('button', { name: /编\s*辑|Edit/ }).first().click();
    await expect(nameInput).toBeEditable();
    await nameInput.fill(newName);

    const [putRes] = await Promise.all([
      page.waitForResponse(
        r => r.url().includes('/user/self') && r.request().method() === 'PUT',
        { timeout: 15_000 },
      ),
      page.getByRole('button', { name: /保\s*存|Save|确定|确认/ }).first().click(),
    ]);
    const putBody = (await putRes.json()) as { success?: boolean; message?: string };
    expect(putBody.success).toBe(true);
    await recorder.step(page, '修改用户名并保存');

    // Persists across a reload.
    await page.reload({ waitUntil: 'domcontentloaded' });
    const reloaded = page.locator('input[placeholder*="username" i]').first();
    await expect(reloaded).toBeVisible({ timeout: 15_000 });
    expect((await reloaded.inputValue()).trim()).toBe(newName);
  } finally {
    // Restore the original username via the API so state is unchanged.
    if (original) {
      const { token } = await acquireRouterToken(baseURL!);
      const ctx = await apiContext(baseURL!, { Authorization: `Bearer ${token}` });
      await ctx
        .put('/api/v1/public/user/self', { data: { username: original, password: '' } })
        .catch(() => {});
      await ctx.dispose();
    }
  }
});

// RT-E2E-005 (P2) — the change-password modal submits to POST /user/self/password.
//
// NON-DESTRUCTIVE: this account has a password set ("已设置"), so the modal opens
// in "modify" mode (current / new / confirm). We submit a deliberately WRONG
// current password (long enough to pass the client-side length check) so the
// server rejects it with "当前密码错误" — the request round-trips and is proven
// without ever changing the real password.
test(localizedTitle("【个人中心与账户设置 / E2E】 RT-E2E-005 设置/修改密码", "the change-password modal round-trips (wrong current password) (RT-E2E-005)"), async ({
  page,
  baseURL,
  recorder,
}) => {
  skipIfNoService();
  skipIfNoKey();
  await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
  await seedWalletSession(page, baseURL!, envFor('router')['ROUTER_WALLET_PRIVATE_KEY']!);
  await page.goto(`${baseURL}/workspace/setting`, { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: /修改密码|Change password/i }).first().click();

  const modal = page.locator('.ant-modal, [role=dialog]').first();
  await expect(modal).toBeVisible({ timeout: 10_000 });
  const pwInputs = modal.locator('input[type=password]');
  await expect(pwInputs.first()).toBeVisible();

  // modify mode: [current, new, confirm]
  const wrongCurrent = 'wrong_current_pw_123';
  const fresh = 'NeverAppliedPw_123';
  await pwInputs.nth(0).fill(wrongCurrent);
  await pwInputs.nth(1).fill(fresh);
  await pwInputs.nth(2).fill(fresh);

  const [res] = await Promise.all([
    page.waitForResponse(
      r => r.url().includes('/user/self/password') && r.request().method() === 'POST',
      { timeout: 15_000 },
    ),
    modal.getByRole('button', { name: /确认修改|确定|确认|Submit|Confirm|OK/ }).first().click(),
  ]);
  const body = (await res.json()) as { success?: boolean; message?: string };
  // Wrong current password → controlled rejection, password unchanged.
  expect(body.success).toBe(false);
  expect(body.message ?? '').toContain('当前密码错误');
  await recorder.step(page, '修改密码提交当前密码错误');
});
