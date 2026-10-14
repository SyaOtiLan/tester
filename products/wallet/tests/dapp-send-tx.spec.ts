/**
 * Wallet — dApp integration: eth_sendTransaction approval window (WL-DAPP-014).
 *
 * A dApp requesting `eth_sendTransaction` must trigger the wallet's
 * transaction approval window (`#transactionRequest`), showing the origin,
 * recipient and value. Approving (`#approveTx`) signs + broadcasts and
 * resolves the dApp promise with the tx hash.
 *
 * The wallet signs with ethers against the *active* network's RPC, so we
 * register a stub network, activate it through the popup UI, and route its
 * RPC via `helpers/rpc.ts` (which returns `keccak256(rawTx)` for the
 * broadcast — a genuine hash without a live chain).
 *
 * Verified against `js/background/request-router.js` handleSendTransaction
 * (requestType 'transaction', onApproved → signTransaction → result.hash;
 * reject → 'User rejected the transaction') and the `#transactionRequest`
 * view in `html/approval.html`.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';
import type { BrowserContext, Page } from '@playwright/test';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { routeRpcNode } from '../helpers/rpc';
import {
  addCustomNetwork,
  byId,
  createAndUnlockWallet,
  openTransferPage,
  pickTransferNetwork,
  waitForApproval,
  type CustomNetworkSpec,
} from '../helpers/popup';

const DAPP_ORIGIN = 'https://dapp.e2e.invalid/';
const NET: CustomNetworkSpec = {
  chainName: 'SendTx E2E',
  chainId: '0x539', // 1337
  rpcUrl: 'https://dapp-sendtx.e2e.invalid/rpc',
  symbol: 'ETH',
};
const RECIPIENT = '0x0000000000000000000000000000000000000001';
const VALUE_HEX = '0x38d7ea4c68000'; // 0.001 ETH

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

test(localizedTitle("【dApp 连接与 Provider / DAPP】 WL-DAPP-014 `eth_sendTransaction` 从 dApp 触发交易审批窗", "WL-DAPP-014: dApp eth_sendTransaction opens the approval window and resolves on approve"), async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await routeRpcNode(ctx.context, 'https://dapp-sendtx.e2e.invalid/**', {
      chainId: NET.chainId,
      balanceWei: '0x8ac7230489e80000', // 10 ETH — cover value + gas
    });
    await serveBlankDapp(ctx.context);

    // Register + activate the stub network so the dApp send broadcasts to it.
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);
    const added = await addCustomNetwork(popup, NET);
    expect(added.success, `add network failed: ${added.error}`).toBe(true);
    await openTransferPage(popup);
    const selector = await pickTransferNetwork(popup, NET.rpcUrl);
    await expect(selector.locator('.network-label')).toHaveText(NET.chainName, { timeout: 5_000 });
    await popup.locator('#transferPage .back-btn:visible').first().click();
    await byId(popup, 'walletPage').waitFor({ state: 'visible' });
    await recorder.step(popup, '激活 stub 网络');

    const dapp = await openDapp(ctx.context);
    const accounts = await connect(ctx.context, ctx.extensionId, dapp);
    const from = accounts[0];
    expect(from).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // dApp requests a transaction; the wallet must pop the approval window.
    const txPromise = dapp.evaluate(
      async ({ from, to, value }) => {
        try {
          const hash = await (globalThis as any).ethereum.request({
            method: 'eth_sendTransaction',
            params: [{ from, to, value }],
          });
          return { ok: true, hash };
        } catch (err: any) {
          return { ok: false, code: err?.code, message: err?.message };
        }
      },
      { from, to: RECIPIENT, value: VALUE_HEX },
    ) as Promise<{ ok: boolean; hash?: string; code?: number; message?: string }>;

    const approval = await waitForApproval(ctx.context, ctx.extensionId, {
      requestType: 'transaction',
    });
    await approval.locator('#transactionRequest').waitFor({ state: 'visible', timeout: 10_000 });
    await expect(approval.locator('#txOrigin')).toContainText('dapp.e2e.invalid');
    await expect(approval.locator('#txTo')).toContainText(RECIPIENT.slice(0, 6));
    await recorder.step(approval, 'eth_sendTransaction 审批窗口');

    await approval.locator('#approveTx').click({ timeout: 10_000 });

    const result = await txPromise;
    expect(result.ok, `send failed: ${result.message}`).toBe(true);
    expect(result.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    await recorder.step(dapp, '审批通过，返回交易哈希');
  } finally {
    await teardownWalletContext(ctx);
  }
});
