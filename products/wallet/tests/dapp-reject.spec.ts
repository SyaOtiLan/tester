/**
 * Wallet — dApp integration: user-rejection flows return EIP-1193 4001.
 *
 * Two P0 cases, both driven against a synthetic https origin we fully
 * control via `context.route` (same technique as popup-signature.spec.ts —
 * no real SPA runs, so nothing competes for the approval window):
 *
 *   WL-DAPP-009  eth_requestAccounts → reject connect (#rejectConnect)
 *                → Promise rejects with code 4001; eth_accounts stays [].
 *
 *   WL-DAPP-002  (after connecting) personal_sign → reject sign (#rejectSign)
 *                → Promise rejects with code 4001; no signature produced.
 *
 * The wallet raises `createUserRejectedError` (ErrorCode.USER_REJECTED =
 * 4001) which the injected provider surfaces as a `ProviderRpcError` with
 * `.code === 4001` (see inject.js).
 */
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { createAndUnlockWallet, waitForApproval } from '../helpers/popup';

const DAPP_ORIGIN = 'https://dapp.e2e.invalid/';

async function serveBlankDapp(context: import('@playwright/test').BrowserContext) {
  await context.route(`${DAPP_ORIGIN}**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><head><meta charset="utf-8"><title>Wallet 协议测试 DApp</title></head><body><main><h1>YeYing Wallet 协议测试 DApp</h1><p>此页面用于验证 Wallet Provider 协议和审批流程。</p><p>当前测试通过 window.ethereum 发起请求，页面本身不包含业务逻辑。</p></main></body></html>',
    });
  });
}

async function openDapp(context: import('@playwright/test').BrowserContext) {
  const dapp = await context.newPage();
  await dapp.goto(DAPP_ORIGIN, { waitUntil: 'domcontentloaded' });
  await dapp.waitForFunction(
    () => (globalThis as any).ethereum?.isYeYing === true,
    undefined,
    { timeout: 20_000 },
  );
  return dapp;
}

test("【dApp 连接与 Provider / DAPP】 WL-DAPP-009 连接请求被拒绝返回 4001", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await serveBlankDapp(ctx.context);
    await createAndUnlockWallet(ctx.context, ctx.extensionId);

    const dapp = await openDapp(ctx.context);

    const connectPromise = dapp.evaluate(async () => {
      try {
        const accounts = await (globalThis as any).ethereum.request({ method: 'eth_requestAccounts' });
        return { ok: true, accounts };
      } catch (err: any) {
        return { ok: false, code: err?.code, message: err?.message };
      }
    });

    const approval = await waitForApproval(ctx.context, ctx.extensionId, { requestType: 'connect' });
    await recorder.step(approval, '连接审批窗口出现,准备拒绝');
    await approval.locator('#rejectConnect').click({ timeout: 10_000 });

    const result = (await connectPromise) as { ok: boolean; code?: number; message?: string };
    expect(result.ok, `expected rejection, got ${JSON.stringify(result)}`).toBe(false);
    expect(result.code).toBe(4001);

    // The site was never authorized → eth_accounts stays empty.
    const accounts = await dapp.evaluate(() =>
      (globalThis as any).ethereum.request({ method: 'eth_accounts' }),
    );
    expect(accounts).toEqual([]);
  } finally {
    await teardownWalletContext(ctx);
  }
});

test("【消息签名与授权 / DAPP】 WL-DAPP-002 dApp `personal_sign` 用户拒绝返回 4001", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await serveBlankDapp(ctx.context);
    await createAndUnlockWallet(ctx.context, ctx.extensionId);

    const dapp = await openDapp(ctx.context);

    // 1) Connect first so the origin is authorized (approve this one).
    const connectPromise = dapp.evaluate(() =>
      (globalThis as any).ethereum.request({ method: 'eth_requestAccounts' }),
    );
    const connectApproval = await waitForApproval(ctx.context, ctx.extensionId, { requestType: 'connect' });
    await connectApproval.locator('#approveConnect').click({ timeout: 10_000 });
    const accounts = (await connectPromise) as string[];
    expect(accounts[0]).toMatch(/^0x[\da-fA-F]{40}$/);

    // 2) personal_sign, then reject at the signature approval window.
    const signPromise = dapp.evaluate(
      async ({ msg, account }) => {
        try {
          const sig = await (globalThis as any).ethereum.request({
            method: 'personal_sign',
            params: [msg, account],
          });
          return { ok: true, sig };
        } catch (err: any) {
          return { ok: false, code: err?.code, message: err?.message };
        }
      },
      { msg: 'YeYing e2e reject test', account: accounts[0] },
    );

    const signApproval = await waitForApproval(ctx.context, ctx.extensionId, { requestType: 'sign_message' });
    await expect(signApproval.locator('#signRequest')).toBeVisible({ timeout: 10_000 });
    await recorder.step(signApproval, '签名审批窗口出现,准备拒绝');
    await signApproval.locator('#rejectSign').click({ timeout: 10_000 });

    const result = (await signPromise) as { ok: boolean; sig?: string; code?: number; message?: string };
    expect(result.ok, `expected rejection, got ${JSON.stringify(result)}`).toBe(false);
    expect(result.code).toBe(4001);
    expect(result.sig).toBeUndefined();
  } finally {
    await teardownWalletContext(ctx);
  }
});
