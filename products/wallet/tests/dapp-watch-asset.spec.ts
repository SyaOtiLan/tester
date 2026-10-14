/**
 * Wallet — dApp integration: wallet_watchAsset (EIP-747) approval (WL-DAPP-013).
 *
 * A dApp asks the wallet to track an ERC-20 token via `wallet_watchAsset`.
 * The wallet opens a dedicated approval window (`type=watchAsset`) that shows
 * the token's symbol / contract address / decimals (js/app/approval.js →
 * renderWatchAssetRequest). Approving resolves the request `true`; rejecting
 * resolves `false` (js/background/request-router.js → handleWatchAsset).
 *
 * Two cases:
 *   - approve (#approveWatchAsset) → request resolves true;
 *   - reject  (#rejectWatchAsset)  → request resolves false.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';
import type { BrowserContext, Page } from '@playwright/test';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { createAndUnlockWallet, waitForApproval } from '../helpers/popup';

const DAPP_ORIGIN = 'https://dapp.e2e.invalid/';
const TOKEN_ADDRESS = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'; // UNI
const TOKEN_SYMBOL = 'E2ETKN';
const TOKEN_DECIMALS = 8;

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

function watchAsset(dapp: Page) {
  return dapp.evaluate(
    async ({ address, symbol, decimals }) => {
      try {
        const result = await (globalThis as any).ethereum.request({
          method: 'wallet_watchAsset',
          params: {
            type: 'ERC20',
            options: { address, symbol, decimals },
          },
        });
        return { ok: true, result };
      } catch (err: any) {
        return { ok: false, code: err?.code, message: err?.message };
      }
    },
    { address: TOKEN_ADDRESS, symbol: TOKEN_SYMBOL, decimals: TOKEN_DECIMALS },
  ) as Promise<{ ok: boolean; result?: unknown; code?: number; message?: string }>;
}

test(localizedTitle("【dApp 连接与 Provider / DAPP】 WL-DAPP-013 批准 wallet_watchAsset 并返回 true", "WL-DAPP-013: wallet_watchAsset shows token details and approving returns true"), async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await serveBlankDapp(ctx.context);
    await createAndUnlockWallet(ctx.context, ctx.extensionId);
    const dapp = await openDapp(ctx.context);

    const requestPromise = watchAsset(dapp);

    const approval = await waitForApproval(ctx.context, ctx.extensionId, {
      requestType: 'watchAsset',
    });
    await expect(approval.locator('#watchAssetRequest')).toBeVisible({ timeout: 10_000 });
    await expect(approval.locator('#assetSymbol')).toHaveText(TOKEN_SYMBOL);
    await expect(approval.locator('#assetAddress')).toHaveText(TOKEN_ADDRESS);
    await expect(approval.locator('#assetDecimals')).toHaveText(String(TOKEN_DECIMALS));
    await recorder.step(approval, 'watchAsset 审批窗展示代币信息');

    await approval.locator('#approveWatchAsset').click({ timeout: 10_000 });

    const result = await requestPromise;
    expect(result.ok, `expected success, got ${JSON.stringify(result)}`).toBe(true);
    expect(result.result).toBe(true);
  } finally {
    await teardownWalletContext(ctx);
  }
});

test(localizedTitle("【dApp 连接与 Provider / DAPP】 WL-DAPP-013 拒绝 wallet_watchAsset 并返回 false", "WL-DAPP-013: rejecting wallet_watchAsset returns false"), async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await serveBlankDapp(ctx.context);
    await createAndUnlockWallet(ctx.context, ctx.extensionId);
    const dapp = await openDapp(ctx.context);

    const requestPromise = watchAsset(dapp);

    const approval = await waitForApproval(ctx.context, ctx.extensionId, {
      requestType: 'watchAsset',
    });
    await expect(approval.locator('#watchAssetRequest')).toBeVisible({ timeout: 10_000 });
    await recorder.step(approval, 'watchAsset 审批窗出现,准备拒绝');
    await approval.locator('#rejectWatchAsset').click({ timeout: 10_000 });

    const result = await requestPromise;
    expect(result.ok, `expected resolved false, got ${JSON.stringify(result)}`).toBe(true);
    expect(result.result).toBe(false);
  } finally {
    await teardownWalletContext(ctx);
  }
});
