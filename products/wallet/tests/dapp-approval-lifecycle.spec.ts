/**
 * Wallet — dApp integration: approval-window lifecycle
 * (WL-DAPP-020, WL-DAPP-021).
 *
 *   WL-DAPP-020  Closing the approval window (without approving/rejecting) is
 *                treated as a rejection: the pending request is removed and the
 *                dApp promise rejects with EIP-1193 code 4001 (see
 *                js/background/approval-flow.js window `onRemoved` cleanup and
 *                js/background/request-router.js windowRemovedListener).
 *
 *   WL-DAPP-021  Two concurrent `eth_requestAccounts` from the SAME origin/tab
 *                reuse a SINGLE approval window (js/background/account-handler.js
 *                → connectInFlight keyed by origin+tab); approving it resolves
 *                BOTH requests with the same account list.
 */
import { test, expect } from '../fixtures';
import type { BrowserContext, Page } from '@playwright/test';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { createAndUnlockWallet, waitForApproval } from '../helpers/popup';

const DAPP_ORIGIN = 'https://dapp.e2e.invalid/';

async function serveBlankDapp(context: BrowserContext) {
  await context.route(`${DAPP_ORIGIN}**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><head><meta charset="utf-8"><title>Wallet 协议测试 DApp</title></head><body><main><h1>YeYing Wallet 协议测试 DApp</h1><p>此页面用于验证 Wallet Provider 协议和审批流程。</p><p>当前测试通过 window.ethereum 发起请求，页面本身不包含业务逻辑。</p></main></body></html>',
    });
  });
}

async function openDapp(context: BrowserContext): Promise<Page> {
  const dapp = await context.newPage();
  await dapp.goto(DAPP_ORIGIN, { waitUntil: 'domcontentloaded' });
  await dapp.waitForFunction(() => (globalThis as any).ethereum?.isYeYing === true, undefined, {
    timeout: 20_000,
  });
  return dapp;
}

test("【错误、异常与安全边界 / DAPP】 WL-DAPP-020 审批窗关闭/超时视为拒绝", async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await serveBlankDapp(ctx.context);
    await createAndUnlockWallet(ctx.context, ctx.extensionId);
    const dapp = await openDapp(ctx.context);

    const connectPromise = dapp.evaluate(async () => {
      try {
        const accounts = await (globalThis as any).ethereum.request({
          method: 'eth_requestAccounts',
        });
        return { ok: true, accounts };
      } catch (err: any) {
        return { ok: false, code: err?.code, message: err?.message };
      }
    });

    const approval = await waitForApproval(ctx.context, ctx.extensionId, { requestType: 'connect' });
    await recorder.step(approval, '连接审批窗出现,直接关闭窗口');

    // Close the window without approving or rejecting.
    await approval.close({ runBeforeUnload: false });

    const result = (await connectPromise) as { ok: boolean; code?: number; message?: string };
    expect(result.ok, `expected rejection, got ${JSON.stringify(result)}`).toBe(false);
    expect(result.code).toBe(4001);

    // The site was never authorized → eth_accounts stays empty.
    const accounts = await dapp.evaluate(() =>
      (globalThis as any).ethereum.request({ method: 'eth_accounts' }),
    );
    expect(accounts).toEqual([]);
    await recorder.step(dapp, '关闭窗口=拒绝(4001),未授权');
  } finally {
    await teardownWalletContext(ctx);
  }
});

test("【错误、异常与安全边界 / DAPP】 WL-DAPP-021 同源并发/重复请求复用同一审批窗", async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await serveBlankDapp(ctx.context);
    await createAndUnlockWallet(ctx.context, ctx.extensionId);
    const dapp = await openDapp(ctx.context);

    // Fire two eth_requestAccounts back-to-back in the same page before either
    // resolves — the wallet must de-dupe them onto one approval window.
    const bothPromise = dapp.evaluate(async () => {
      const eth = (globalThis as any).ethereum;
      const settle = (p: Promise<any>) =>
        p.then(
          (accounts) => ({ ok: true, accounts }),
          (err) => ({ ok: false, code: err?.code, message: err?.message }),
        );
      return Promise.all([
        settle(eth.request({ method: 'eth_requestAccounts' })),
        settle(eth.request({ method: 'eth_requestAccounts' })),
      ]);
    });

    // Exactly one approval window opens.
    const approval = await waitForApproval(ctx.context, ctx.extensionId, { requestType: 'connect' });

    // No second approval window appears within a short grace period.
    const secondWindow = await ctx.context
      .waitForEvent('page', {
        predicate: (p) =>
          p.url().startsWith(`chrome-extension://${ctx.extensionId}/html/approval.html`) &&
          new URL(p.url()).searchParams.get('type') === 'connect' &&
          p !== approval,
        timeout: 4_000,
      })
      .then(() => true)
      .catch(() => false);
    expect(secondWindow, 'a second approval window should NOT open').toBe(false);
    await recorder.step(approval, '同源并发连接复用同一审批窗');

    await approval.locator('#approveConnect').click({ timeout: 10_000 });

    const [r1, r2] = (await bothPromise) as Array<{ ok: boolean; accounts?: string[] }>;
    expect(r1.ok && r2.ok, `both should resolve: ${JSON.stringify([r1, r2])}`).toBe(true);
    expect(r1.accounts![0]).toMatch(/^0x[\da-fA-F]{40}$/);
    // Both concurrent calls resolve to the same account list.
    expect(r1.accounts).toEqual(r2.accounts);
    await recorder.step(dapp, '两个并发请求返回相同账户');
  } finally {
    await teardownWalletContext(ctx);
  }
});
