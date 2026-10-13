/**
 * Wallet — dApp integration: EIP-2255 permissions lifecycle (WL-DAPP-010).
 *
 * Against a synthetic https origin (controlled via context.route):
 *
 *   1. wallet_requestPermissions({ eth_accounts: {} }) → the wallet opens a
 *      connect approval window → approve (#approveConnect). The result is an
 *      array with a permission whose parentCapability === 'eth_accounts'.
 *   2. wallet_getPermissions → contains the eth_accounts permission.
 *   3. wallet_revokePermissions({ eth_accounts: {} }) → authorization removed.
 *   4. wallet_getPermissions → []; eth_accounts → [].
 *
 * Verified in js/background/account-handler.js:
 *   - handleWalletRequestPermissions routes eth_accounts → eth_requestAccounts
 *     (connect approval window).
 *   - buildEthAccountsPermission → { parentCapability:'eth_accounts', caveats:[…] }.
 *   - handleWalletRevokePermissions deletes the authorization.
 */
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { createAndUnlockWallet, waitForApproval } from '../helpers/popup';

const DAPP_ORIGIN = 'https://dapp.e2e.invalid/';

test("【dApp 连接与 Provider / DAPP】 WL-DAPP-010 EIP-2255 权限:request / get / revoke", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await ctx.context.route(`${DAPP_ORIGIN}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html><head><meta charset="utf-8"><title>Wallet 协议测试 DApp</title></head><body><main><h1>YeYing Wallet 协议测试 DApp</h1><p>此页面用于验证 Wallet Provider 协议和审批流程。</p><p>当前测试通过 window.ethereum 发起请求，页面本身不包含业务逻辑。</p></main></body></html>',
      });
    });
    await createAndUnlockWallet(ctx.context, ctx.extensionId);

    const dapp = await ctx.context.newPage();
    await dapp.goto(DAPP_ORIGIN, { waitUntil: 'domcontentloaded' });
    await dapp.waitForFunction(
      () => (globalThis as any).ethereum?.isYeYing === true,
      undefined,
      { timeout: 20_000 },
    );

    // -- 1) wallet_requestPermissions({ eth_accounts: {} }) → approve ----
    const requestPromise = dapp.evaluate(async () => {
      try {
        const perms = await (globalThis as any).ethereum.request({
          method: 'wallet_requestPermissions',
          params: [{ eth_accounts: {} }],
        });
        return { ok: true, perms };
      } catch (err: any) {
        return { ok: false, code: err?.code, message: err?.message };
      }
    });

    const approval = await waitForApproval(ctx.context, ctx.extensionId, { requestType: 'connect' });
    await recorder.step(approval, '权限请求审批窗口(EIP-2255)');
    await approval.locator('#approveConnect').click({ timeout: 10_000 });

    const requested = (await requestPromise) as { ok: boolean; perms?: any[]; message?: string };
    expect(requested.ok, requested.message).toBe(true);
    expect(Array.isArray(requested.perms)).toBe(true);
    expect(requested.perms!.some((p) => p?.parentCapability === 'eth_accounts')).toBe(true);

    // -- 2) wallet_getPermissions contains eth_accounts ------------------
    const granted = (await dapp.evaluate(() =>
      (globalThis as any).ethereum.request({ method: 'wallet_getPermissions' }),
    )) as any[];
    expect(granted.some((p) => p?.parentCapability === 'eth_accounts')).toBe(true);

    // -- 3) wallet_revokePermissions({ eth_accounts: {} }) ---------------
    await dapp.evaluate(() =>
      (globalThis as any).ethereum.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      }),
    );

    // -- 4) after revoke: no permissions, no accounts -------------------
    const afterPerms = (await dapp.evaluate(() =>
      (globalThis as any).ethereum.request({ method: 'wallet_getPermissions' }),
    )) as any[];
    expect(afterPerms.some((p) => p?.parentCapability === 'eth_accounts')).toBe(false);

    const afterAccounts = await dapp.evaluate(() =>
      (globalThis as any).ethereum.request({ method: 'eth_accounts' }),
    );
    expect(afterAccounts).toEqual([]);
  } finally {
    await teardownWalletContext(ctx);
  }
});
