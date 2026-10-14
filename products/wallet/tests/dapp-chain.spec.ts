/**
 * Wallet — dApp integration: chain switch / add / mismatch
 * (WL-DAPP-011, WL-DAPP-012, WL-DAPP-019).
 *
 * Driven against a synthetic https origin controlled via `context.route`.
 *
 * IMPLEMENTATION NOTE (matters for these assertions): this wallet handles
 * `wallet_switchEthereumChain` and `wallet_addEthereumChain` *directly* in
 * the background router — there is NO approval window for either (see
 * `js/background/chain-handler.js`). So the doc's `#addChainRequest` /
 * `#approveAddChain` approval UI does not exist for this build; we assert the
 * real behavior instead:
 *   - switch to a known chain succeeds silently, emits `chainChanged`, and
 *     updates `ethereum.chainId`;
 *   - switch to an unknown chain rejects with EIP-3326 code 4902;
 *   - add a new chain silently registers + activates it (chainChanged);
 *   - a mismatch (switch to an un-added chain) is refused with 4902 and the
 *     wallet does NOT silently move to the wrong chain.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';
import type { BrowserContext, Page } from '@playwright/test';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { createAndUnlockWallet, waitForApproval } from '../helpers/popup';

const DAPP_ORIGIN = 'https://dapp.e2e.invalid/';

// Built-in chains: YeYing Mainnet 0x1538 (default) and Ethereum Mainnet 0x1.
const ETH_MAINNET = '0x1';
const UNKNOWN_CHAIN = '0x270f'; // 9999, never added

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
  // Track chainChanged events on the page for later assertions.
  await dapp.evaluate(() => {
    (globalThis as any).__chainChanges = [];
    (globalThis as any).ethereum.on('chainChanged', (c: string) =>
      (globalThis as any).__chainChanges.push(c),
    );
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

async function requestChain(dapp: Page, method: string, params: unknown[]) {
  return dapp.evaluate(
    async ({ method, params }) => {
      try {
        const result = await (globalThis as any).ethereum.request({ method, params });
        return { ok: true, result };
      } catch (err: any) {
        return { ok: false, code: err?.code, message: err?.message };
      }
    },
    { method, params },
  ) as Promise<{ ok: boolean; result?: unknown; code?: number; message?: string }>;
}

test(localizedTitle("【dApp 连接与 Provider / DAPP】 WL-DAPP-011 `wallet_switchEthereumChain`(EIP-3326)审批 + chainChanged", "WL-DAPP-011: switch to a known chain emits chainChanged; unknown chain returns 4902"), async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await serveBlankDapp(ctx.context);
    await createAndUnlockWallet(ctx.context, ctx.extensionId);
    const dapp = await openDapp(ctx.context);
    await connect(ctx.context, ctx.extensionId, dapp);
    await recorder.step(dapp, 'dApp 已连接');

    // Switch to Ethereum mainnet (a known/built-in chain) → success.
    const switched = await requestChain(dapp, 'wallet_switchEthereumChain', [{ chainId: ETH_MAINNET }]);
    expect(switched.ok, `switch failed: ${switched.message}`).toBe(true);

    await expect
      .poll(() => dapp.evaluate(() => (globalThis as any).ethereum.chainId), { timeout: 10_000 })
      .toBe(ETH_MAINNET);
    const changes = (await dapp.evaluate(() => (globalThis as any).__chainChanges)) as string[];
    expect(changes).toContain(ETH_MAINNET);
    await recorder.step(dapp, `chainChanged → ${ETH_MAINNET}`);

    // Switch to an unknown chain → EIP-3326 4902.
    const unknown = await requestChain(dapp, 'wallet_switchEthereumChain', [{ chainId: UNKNOWN_CHAIN }]);
    expect(unknown.ok).toBe(false);
    expect(unknown.code).toBe(4902);
    await recorder.step(dapp, '未知链返回 4902');
  } finally {
    await teardownWalletContext(ctx);
  }
});

test(localizedTitle("【dApp 连接与 Provider / DAPP】 WL-DAPP-012 `wallet_addEthereumChain`(EIP-3085)审批", "WL-DAPP-012: wallet_addEthereumChain registers and activates a new chain"), async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  const NEW_CHAIN = '0x2328'; // 9000
  const NEW_RPC = 'https://addchain.e2e.invalid/rpc';
  try {
    await stubPublicEndpoints(ctx.context);
    // The new chain's RPC is never actually dialed by add/switch, but route
    // it to abort so nothing can leak to a real host.
    await ctx.context.route('https://addchain.e2e.invalid/**', (route) =>
      route.abort('connectionfailed'),
    );
    await serveBlankDapp(ctx.context);
    await createAndUnlockWallet(ctx.context, ctx.extensionId);
    const dapp = await openDapp(ctx.context);
    await connect(ctx.context, ctx.extensionId, dapp);

    const added = await requestChain(dapp, 'wallet_addEthereumChain', [
      {
        chainId: NEW_CHAIN,
        chainName: 'AddChain E2E',
        rpcUrls: [NEW_RPC],
        nativeCurrency: { name: 'Test', symbol: 'TST', decimals: 18 },
        blockExplorerUrls: ['https://explorer.addchain.e2e.invalid'],
      },
    ]);
    expect(added.ok, `addEthereumChain failed: ${added.message}`).toBe(true);
    await recorder.step(dapp, 'wallet_addEthereumChain 已接受');

    // The wallet adds + switches to the new chain (silent), so the dApp sees
    // chainChanged and eth_chainId reflects it.
    await expect
      .poll(() => dapp.evaluate(() => (globalThis as any).ethereum.chainId), { timeout: 10_000 })
      .toBe(NEW_CHAIN);
    const reported = await dapp.evaluate(() =>
      (globalThis as any).ethereum.request({ method: 'eth_chainId' }),
    );
    expect(reported).toBe(NEW_CHAIN);
    const changes = (await dapp.evaluate(() => (globalThis as any).__chainChanges)) as string[];
    expect(changes).toContain(NEW_CHAIN);
    await recorder.step(dapp, `新链已加入并激活 → ${NEW_CHAIN}`);
  } finally {
    await teardownWalletContext(ctx);
  }
});

test(localizedTitle("【错误、异常与安全边界 / DAPP】 WL-DAPP-019 链不匹配的提示与处理", "WL-DAPP-019: a chain mismatch is refused (4902) without silently switching"), async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await serveBlankDapp(ctx.context);
    await createAndUnlockWallet(ctx.context, ctx.extensionId);
    const dapp = await openDapp(ctx.context);
    await connect(ctx.context, ctx.extensionId, dapp);

    const chainBefore = (await dapp.evaluate(() => (globalThis as any).ethereum.chainId)) as string;
    await recorder.step(dapp, `当前链 ${chainBefore}`);

    // dApp expects to operate on a chain the wallet does not have: the wallet
    // must refuse (4902) and guide to add — never silently proceed.
    const mismatch = await requestChain(dapp, 'wallet_switchEthereumChain', [
      { chainId: '0x89' }, // Polygon, not added
    ]);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.code).toBe(4902);

    // The active chain is unchanged — no silent switch to the wrong chain.
    const chainAfter = (await dapp.evaluate(() => (globalThis as any).ethereum.chainId)) as string;
    expect(chainAfter).toBe(chainBefore);
    const changes = (await dapp.evaluate(() => (globalThis as any).__chainChanges)) as string[];
    expect(changes).not.toContain('0x89');
    await recorder.step(dapp, '链不匹配被拒绝，未静默切链');
  } finally {
    await teardownWalletContext(ctx);
  }
});
