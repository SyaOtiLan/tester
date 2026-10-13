/**
 * Wallet — dApp integration: eth_signTypedData_v4 approval (WL-DAPP-003).
 *
 * A dApp signs an EIP-712 typed-data payload. The wallet tags the approval
 * window `type=sign_typed_data` (request-router.js) and renders it in the
 * shared `#signRequest` view; the user clicks 签名 (#approveSign) and the
 * dApp receives a 65-byte signature.
 *
 * Same synthetic-origin technique as popup-signature.spec.ts.
 */
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { createAndUnlockWallet, waitForApproval } from '../helpers/popup';

const DAPP_ORIGIN = 'https://dapp.e2e.invalid/';

test("【消息签名与授权 / DAPP】 WL-DAPP-003 `eth_signTypedData_v4` 审批通过(EIP-712)", async ({ recorder }) => {
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

    // Connect first.
    const connectPromise = dapp.evaluate(() =>
      (globalThis as any).ethereum.request({ method: 'eth_requestAccounts' }),
    );
    const connectApproval = await waitForApproval(ctx.context, ctx.extensionId, { requestType: 'connect' });
    await connectApproval.locator('#approveConnect').click({ timeout: 10_000 });
    const accounts = (await connectPromise) as string[];
    const account = accounts[0];
    expect(account).toMatch(/^0x[\da-fA-F]{40}$/);

    // Standard EIP-712 typed data (the canonical Mail example).
    const signPromise = dapp.evaluate(
      async ({ account }) => {
        const typedData = {
          types: {
            EIP712Domain: [
              { name: 'name', type: 'string' },
              { name: 'version', type: 'string' },
              { name: 'chainId', type: 'uint256' },
              { name: 'verifyingContract', type: 'address' },
            ],
            Person: [
              { name: 'name', type: 'string' },
              { name: 'wallet', type: 'address' },
            ],
            Mail: [
              { name: 'from', type: 'Person' },
              { name: 'to', type: 'Person' },
              { name: 'contents', type: 'string' },
            ],
          },
          primaryType: 'Mail',
          domain: {
            name: 'YeYing E2E',
            version: '1',
            chainId: 1,
            verifyingContract: '0xcccccccccccccccccccccccccccccccccccccccc',
          },
          message: {
            from: { name: 'Alice', wallet: account },
            to: { name: 'Bob', wallet: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
            contents: 'Hello from the YeYing e2e suite',
          },
        };
        try {
          const sig = await (globalThis as any).ethereum.request({
            method: 'eth_signTypedData_v4',
            params: [account, JSON.stringify(typedData)],
          });
          return { ok: true, sig };
        } catch (err: any) {
          return { ok: false, code: err?.code, message: err?.message };
        }
      },
      { account },
    );

    const signApproval = await waitForApproval(ctx.context, ctx.extensionId, { requestType: 'sign_typed_data' });
    await expect(signApproval.locator('#signRequest')).toBeVisible({ timeout: 10_000 });
    await recorder.step(signApproval, 'EIP-712 结构化签名审批窗口');
    await signApproval.locator('#approveSign').click({ timeout: 10_000 });

    const result = (await signPromise) as { ok: boolean; sig?: string; message?: string };
    expect(result.ok, result.message).toBe(true);
    expect(result.sig!).toMatch(/^0x[0-9a-fA-F]{130}$/);
  } finally {
    await teardownWalletContext(ctx);
  }
});
