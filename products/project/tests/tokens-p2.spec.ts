/**
 * project — automation token AK/SK auth & UI creation (P2).
 *
 * Covers PJ-123 (token audit log — admin, skipped), PJ-124 (call a restricted
 * API with AK/SK request signing), PJ-125 (create a token in the settings UI
 * and reveal its secret).
 *
 * AK/SK signing (see app/Services/AutomationTokenService.php):
 *   canonical = METHOD \n /path \n canonicalQuery \n sha256hex(body) \n ts \n nonce
 *   signature = HMAC-SHA256(canonical, key = sha256hex(secret_key))
 *   headers: X-YY-AK, X-YY-Timestamp (ISO8601), X-YY-Nonce, X-YY-Signature
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
import { test, expect, baseURLFor } from '../fixtures';
import { registerUser, apiPost, createProject } from '../helpers/api';
import { seedUiSession } from '../helpers/session';
import { createHash, createHmac, randomBytes } from 'crypto';
import { request } from '@playwright/test';

const baseURL = baseURLFor('project');

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

/** Build the AK/SK signature headers for a GET request with no query/body. */
function signGet(path: string, accessKey: string, secretKey: string): Record<string, string> {
  const timestamp = new Date().toISOString();
  const nonce = randomBytes(12).toString('hex');
  const canonical = [
    'GET',
    '/' + path.replace(/^\/+/, ''),
    '', // canonical query (none)
    sha256hex(''), // sha256 of empty body
    timestamp,
    nonce,
  ].join('\n');
  const signature = createHmac('sha256', sha256hex(secretKey)).update(canonical).digest('hex');
  return {
    'X-YY-AK': accessKey,
    'X-YY-Timestamp': timestamp,
    'X-YY-Nonce': nonce,
    'X-YY-Signature': signature,
  };
}

test.describe("【自动化访问令牌】项目自动化代币 AK/SK 和 UI (P2)（project automation tokens AK/SK & UI (P2)）", () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  // PJ-123 令牌审计记录
  test("【自动化访问令牌 / API】 PJ-123 令牌审计记录", async () => {
    test.skip(true, 'token/admin/audits requires identity("admin"); the site admin account is captcha-locked and cannot be driven with a throwaway user.');
  });

  // PJ-124 使用 AK/SK 头鉴权调用受限接口
  test("【自动化访问令牌 / API】 PJ-124 使用 AK/SK 头鉴权调用受限接口", async () => {
    const user = await registerUser(baseURL!);
    const { id: pid } = await createProject(baseURL!, user.token, { name: `AKSK项目${Date.now() % 100000}` });
    const created = await apiPost(
      baseURL!,
      '/api/token/create',
      { name: `aksk-${Date.now() % 100000}`, project_ids: [pid], scopes: ['file_cabinet'] },
      user.token,
    );
    expect(created.ret, `token/create failed: ${created.msg}`).toBe(1);
    const accessKey: string = created.data.access_key;
    const secretKey: string = created.data.secret_key;

    // A correctly signed request authenticates and reaches the file_cabinet-scoped endpoint.
    const okCtx = await request.newContext({ baseURL: baseURL!, extraHTTPHeaders: signGet('api/file/lists', accessKey, secretKey) });
    try {
      const ok = await (await okCtx.get('/api/file/lists')).json();
      expect(ok.ret, `AK/SK call failed: ${ok.msg}`).toBe(1);
    } finally {
      await okCtx.dispose();
    }

    // A wrong signature is rejected.
    const badCtx = await request.newContext({ baseURL: baseURL!, extraHTTPHeaders: signGet('api/file/lists', accessKey, 'yysk_wrongsecret') });
    try {
      const bad = await (await badCtx.get('/api/file/lists')).json();
      expect(bad.ret).toBe(0);
      expect(bad.msg).toBe('访问令牌认证失败');
    } finally {
      await badCtx.dispose();
    }

    // An access key with no signature headers is rejected too.
    const noSigCtx = await request.newContext({ baseURL: baseURL!, extraHTTPHeaders: { 'X-YY-AK': accessKey } });
    try {
      const noSig = await (await noSigCtx.get('/api/file/lists')).json();
      expect(noSig.ret).toBe(0);
      expect(noSig.msg).toBe('访问令牌认证失败');
    } finally {
      await noSigCtx.dispose();
    }
  });

  // PJ-125 UI 设置页创建令牌并显示密钥
  test("【自动化访问令牌 / UI】 PJ-125 UI 设置页创建令牌并显示密钥", async ({ page }) => {
    const acc = await seedUiSession(page, baseURL!);
    // A token needs a project the user participates in; the registration flow
    // already created a personal project, but make an explicit one to be safe.
    await createProject(baseURL!, acc.token, { name: `令牌UI${Date.now() % 100000}` });

    await page.goto('/#/manage/setting/automation-token', { waitUntil: 'domcontentloaded' });

    // Open the create-token modal.
    const openBtn = page.getByRole('button', { name: '创建令牌' }).first();
    await openBtn.waitFor({ state: 'visible', timeout: 20_000 });
    await openBtn.click();

    // The modal titled "创建访问令牌" carries a name input + a project select.
    await expect(page.getByText('创建访问令牌').first()).toBeVisible({ timeout: 10_000 });
    const nameInput = page.locator('.ivu-modal input[placeholder="例如 codex-local"]').first();
    await nameInput.waitFor({ state: 'visible', timeout: 10_000 });
    await nameInput.fill(`ui-tok-${Date.now() % 100000}`);

    // Pick the first project option from the multiple Select.
    const select = page.locator('.ivu-modal .ivu-select').first();
    await select.click();
    const firstOption = page.locator('.ivu-select-dropdown .ivu-select-item').first();
    await firstOption.waitFor({ state: 'visible', timeout: 10_000 });
    await firstOption.click();
    // Close the dropdown before clicking the footer button.
    await page.keyboard.press('Escape');

    // Grant the file_cabinet scope (checkbox) if present, then submit.
    const scope = page.locator('.ivu-modal .ivu-checkbox-wrapper').first();
    if (await scope.count()) {
      await scope.click();
    }
    await page.getByRole('button', { name: '创建', exact: true }).first().click();

    // The success modal reveals the plaintext Access Key / Secret Key.
    await expect(page.getByText('请立即保存密钥').first()).toBeVisible({ timeout: 15_000 });
    const revealed = await page.locator('.ivu-modal input').evaluateAll((els) =>
      (els as HTMLInputElement[]).map((e) => e.value).join(' '),
    );
    expect(revealed).toContain('yyak_');
    expect(revealed).toContain('yysk_');
  });
});
