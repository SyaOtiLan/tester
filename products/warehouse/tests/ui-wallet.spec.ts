/**
 * warehouse — UI smoke: the wallet login button is present, reaches the
 * SDK on click, and surfaces a clean error when the UCAN identity flow
 * fails.
 *
 * The live "钱包登录" button drives `@yeying-community/web3-bs`'s
 * `loginWithWalletIdentity` flow, which builds a UCAN-style presentation
 * that is too complex to mock without standing up a real wallet. This
 * spec covers the slice of behaviour that *is* mockable + observable:
 *
 *   - the unauthenticated landing page renders both login options
 *     (wallet + passport);
 *   - when a wallet shim is mounted, clicking the wallet button drives
 *     the SDK through `eth_requestAccounts` + `wallet_requestPermissions`
 *     and POSTs to `/api/v1/public/auth/identity/login/{session,verify}`;
 *   - when the backend rejects the presentation (because our shim only
 *     returns a stub permission object), the UI surfaces a clean error
 *     dialog instead of crashing.
 *
 * End-to-end authentication is exercised by:
 *   - siwe.spec.ts (classical SIWE challenge/verify against /api/v1/public/auth)
 *   - ui-authenticated.spec.ts (browser post-login UI seeded from a JWT)
 *   - the warehouse backend integration tests (full UCAN path against a
 *     real wallet).
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { injectWallet } from '../helpers/wallet';

function skipIfNoService() {
  test.skip(!baseURLFor('warehouse'), 'WAREHOUSE_BASE_URL not configured');
}

test(localizedTitle("【文件管理与导航界面 / UI】 登陆页面呈现钱包+护照登录选项", "landing page renders the wallet + passport login options"), async ({ page, baseURL }) => {
  skipIfNoService();
  await page.goto(baseURL!, { waitUntil: 'networkidle' });

  await expect(page.getByRole('button', { name: '通行证登录' })).toBeVisible();
  // The wallet button only shows up when window.ethereum is detected; in
  // headless without a wallet the landing shows "未检测到钱包" instead.
  const walletBtn = page.getByRole('button', { name: '钱包登录' });
  const noWallet = page.getByText('未检测到钱包插件');
  await expect(walletBtn.or(noWallet)).toBeVisible();
});

test(localizedTitle("【文件管理与导航界面 / UI】 钱包按钮点击驱动 SDK 身份流程并显示一个干净的错误", "wallet button click drives the SDK identity flow and surfaces a clean error"), async ({
  page,
  baseURL,
}) => {
  skipIfNoService();
  const env = envFor('warehouse');
  test.skip(!env['WAREHOUSE_WALLET_PRIVATE_KEY'], 'WAREHOUSE_WALLET_PRIVATE_KEY not configured');

  // Mount the wallet shim before the page scripts run so the SDK picks
  // up our EIP-1193 provider instead of "未检测到钱包".
  await injectWallet(page, env['WAREHOUSE_WALLET_PRIVATE_KEY']!);

  // Capture the SDK's identity-presentation network calls so we can
  // assert the SDK actually used our shim (not just rendered a button).
  // Timeout is generous — the warehouse SDK issues a few round-trips
  // before the session POST (e.g. challenge/nonce bootstrap) and the
  // dev server cold-warm under parallel load can take a while.
  const sessionSeen = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/v1/public/auth/identity/login/session') &&
      r.request().method() === 'POST',
    { timeout: 20_000 },
  );

  await page.goto(baseURL!, { waitUntil: 'networkidle' });
  const walletButton = page.getByRole('button', { name: '钱包登录' });
  await expect(walletButton).toBeVisible({ timeout: 15_000 });

  // Click + assert the session call was made.
  await walletButton.click();
  const sessionRes = await sessionSeen;
  expect(sessionRes.status()).toBe(200);

  // The SDK proceeds to /identity/login/verify with our shim's signed
  // UCAN. Our shim returns a stub permission object, so the server
  // rejects it as IDENTITY_PRESENTATION_INVALID. The UI should surface
  // that as a clean Element Plus dialog — not a JS crash or blank page.
  await expect(page.getByRole('dialog', { name: '错误' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/IDENTITY_PRESENTATION_INVALID|钱包登录失败/)).toBeVisible();

  // We never navigated away from the landing page.
  await expect(page.getByRole('button', { name: '通行证登录' })).toBeVisible();
});