/**
 * Wallet — dApp integration: locked wallet → unlock approval (WL-DAPP-016).
 *
 * When the wallet is locked, a dApp request that needs the keyring
 * (`eth_requestAccounts` is in `unlockMethods`) makes the background open an
 * unlock approval window (`html/approval.html?type=unlock`). Entering the
 * password and approving (`#approveUnlock`) unlocks the keyring and lets the
 * original request complete — the dApp promise resolves with the accounts.
 *
 * Verified against `js/background/request-router.js` (unlockMethods →
 * `requestUnlock` when `!selectedAccountUnlocked`, gated by `isActiveTab`)
 * and `js/background/unlock-flow.js` (`approval.html?type=unlock`), with the
 * `#unlockRequest` view in `html/approval.html`.
 *
 * NOTE: `requestUnlock` requires the requesting dApp tab to be the active,
 * focused tab — so we close the popup and bring the dApp to front before
 * firing the request.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';
import type { BrowserContext, Page } from '@playwright/test';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { createAndUnlockWallet, sendSw, TEST_PASSWORD, waitForApproval } from '../helpers/popup';

const DAPP_ORIGIN = 'https://dapp.e2e.invalid/';

async function serveBlankDapp(context: BrowserContext) {
  await context.route(`${DAPP_ORIGIN}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><head><meta charset="utf-8"><title>Wallet 协议测试 DApp</title></head><body><main><h1>YeYing Wallet 协议测试 DApp</h1><p>此页面用于验证 Wallet Provider 协议和审批流程。</p><p>当前测试通过 window.ethereum 发起请求，页面本身不包含业务逻辑。</p></main></body></html>',
    }),
  );
}

async function openDapp(context: BrowserContext): Promise<Page> {
  const dapp = await context.newPage();
  await dapp.goto(DAPP_ORIGIN, { waitUntil: 'domcontentloaded' });
  await dapp.waitForFunction(() => (globalThis as any).ethereum?.isYeYing === true, undefined, {
    timeout: 20_000,
  });
  return dapp;
}

async function connect(context: BrowserContext, extensionId: string, dapp: Page): Promise<string[]> {
  const p = dapp.evaluate(() =>
    (globalThis as any).ethereum.request({ method: 'eth_requestAccounts' }),
  );
  const approval = await waitForApproval(context, extensionId, { requestType: 'connect' });
  await approval.locator('#approveConnect').click({ timeout: 10_000 });
  return (await p) as string[];
}

test(localizedTitle("【dApp 连接与 Provider / DAPP】 WL-DAPP-016 钱包锁定时 dApp 请求触发解锁审批窗", "WL-DAPP-016: a request against a locked wallet opens the unlock approval and then completes"), async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await serveBlankDapp(ctx.context);

    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);
    const dapp = await openDapp(ctx.context);
    const connected = await connect(ctx.context, ctx.extensionId, dapp);
    expect(connected.length).toBeGreaterThan(0);
    await recorder.step(dapp, 'dApp 已连接');

    // Lock the wallet, then close the popup so the dApp tab is the active,
    // focused tab (a precondition for the unlock flow to trigger).
    await sendSw(popup, 'LOCK_WALLET');
    await recorder.step(popup, '锁定钱包');
    await popup.close();
    await dapp.bringToFront();

    // A keyring-requiring request now triggers an unlock approval window.
    const accountsPromise = dapp.evaluate(
      async () => {
        try {
          const accounts = await (globalThis as any).ethereum.request({
            method: 'eth_requestAccounts',
          });
          return { ok: true, accounts };
        } catch (err: any) {
          return { ok: false, code: err?.code, message: err?.message };
        }
      },
    ) as Promise<{ ok: boolean; accounts?: string[]; code?: number; message?: string }>;

    const unlock = await waitForApproval(ctx.context, ctx.extensionId, { requestType: 'unlock' });
    await unlock.locator('#unlockRequest').waitFor({ state: 'visible', timeout: 10_000 });
    await recorder.step(unlock, 'dApp 触发解锁审批窗口');
    await unlock.locator('#unlockPassword').fill(TEST_PASSWORD);
    await unlock.locator('#approveUnlock').click({ timeout: 10_000 });

    const result = await accountsPromise;
    expect(result.ok, `request failed: ${result.message}`).toBe(true);
    expect(result.accounts!.length).toBeGreaterThan(0);
    expect(result.accounts![0]).toMatch(/^0x[0-9a-fA-F]{40}$/);
    await recorder.step(dapp, '解锁后请求完成，返回账户');
  } finally {
    await teardownWalletContext(ctx);
  }
});
