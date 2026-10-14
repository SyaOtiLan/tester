/**
 * Wallet — dApp integration: personal_sign approval flow.
 *
 * The connect/approval flow is covered by the dapp-* specs. This one drives
 * the *signature* approval window: a dApp calls `personal_sign`, the wallet
 * opens `approval.html?type=sign_message`, the user reviews the message and
 * clicks 签名 (#approveSign), and the dApp receives a 65-byte signature.
 *
 *   1. Create + unlock a wallet.
 *   2. Open a blank page at a synthetic https origin. The extension's
 *      content script matches `https://*\/*`, so `window.ethereum` is
 *      injected even though the page is served locally via `context.route`
 *      (no real SPA runs, so nothing competes for the approval window).
 *   3. eth_requestAccounts → approve connect (grants the origin).
 *   4. personal_sign → approve sign (#approveSign).
 *   5. Assert the returned signature is 0x + 130 hex chars (65 bytes).
 *
 * NB: the wallet's background tags a personal_sign approval window with
 * `type=sign_message` in the URL (request-router.js), while the approval
 * app normalizes that to `sign` only for internal rendering. So we filter
 * on `sign_message`, not `sign`.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { createAndUnlockWallet, waitForApproval } from '../helpers/popup';

// A synthetic origin we fully control via context.route. `.invalid` never
// resolves on the network, but route.fulfill intercepts before DNS, and the
// content script still injects the provider because the URL is https.
const DAPP_ORIGIN = 'https://dapp.e2e.invalid/';

test(localizedTitle("【消息签名与授权 / DAPP】 dApp personal_sign 被批准并返回有效签名", "dApp personal_sign is approved and returns a valid signature"), async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);

    // Serve a minimal blank page at the synthetic dApp origin so no SPA JS
    // runs — nothing else calls personal_sign or opens approval windows.
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

    // 1) Connect first so the origin is authorized.
    const connectPromise = dapp.evaluate(() =>
      (globalThis as any).ethereum.request({ method: 'eth_requestAccounts' }),
    );
    const connectApproval = await waitForApproval(ctx.context, ctx.extensionId, {
      requestType: 'connect',
    });
    await connectApproval.locator('#approveConnect').click({ timeout: 10_000 });
    const accounts = (await connectPromise) as string[];
    expect(accounts[0]).toMatch(/^0x[\da-fA-F]{40}$/);
    await recorder.step(dapp, 'dApp 已连接钱包');

    // 2) Request a personal_sign of a plain message.
    const message = 'YeYing e2e signature test';
    const signPromise = dapp.evaluate(
      async ({ msg, account }) => {
        try {
          const sig = await (globalThis as any).ethereum.request({
            method: 'personal_sign',
            params: [msg, account],
          });
          return { ok: true, sig };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      { msg: message, account: accounts[0] },
    );

    // 3) Approve the signature request (URL type is `sign_message`).
    const signApproval = await waitForApproval(ctx.context, ctx.extensionId, {
      requestType: 'sign_message',
    });
    await expect(signApproval.locator('#signRequest')).toBeVisible({ timeout: 10_000 });
    await recorder.step(signApproval, '签名审批窗口出现');
    await signApproval.locator('#approveSign').click({ timeout: 10_000 });

    const result = (await signPromise) as { ok: boolean; sig?: string; error?: string };
    expect(result.ok, result.error).toBe(true);
    // 65-byte ECDSA signature: 0x + 130 hex chars.
    expect(result.sig!).toMatch(/^0x[0-9a-fA-F]{130}$/);
  } finally {
    await teardownWalletContext(ctx);
  }
});
