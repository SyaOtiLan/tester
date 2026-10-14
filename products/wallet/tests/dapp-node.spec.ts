/**
 * Wallet — dApp integration: real wallet extension drives the node SPA.
 *
 * Mirrors `dapp-router.spec.ts`. The node SPA is Vue + Element Plus
 * with a "连接钱包" (zh) / "Connect Wallet" (en) button in the header
 * (`Header.vue`) wired to `connectWallet()` which calls
 * `wallet_requestPermissions` → the wallet shows an approval window
 * → user approves → SIWE handshake starts.
 *
 * Each test:
 *
 *   1. Launches a persistent Chromium context with the wallet loaded.
 *   2. Stubs the wallet's default public endpoints.
 *   3. Creates + unlocks a wallet in the popup.
 *   4. Opens the node SPA, asserts the wallet injected itself
 *      (`window.ethereum.isYeYing === true`).
 *   5. Exercises either provider discovery or the approval flow.
 *
 * Skips if `NODE_BASE_URL` is unset or the SPA doesn't respond.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { createAndUnlockWallet, waitForApproval } from '../helpers/popup';

function skipIfNoNodeSPA() {
  test.skip(!baseURLFor('node'), 'NODE_BASE_URL not configured');
}

async function ensureNodeReachable(url: string) {
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5_000) });
    test.skip(res.status >= 500, `node SPA returned HTTP ${res.status}`);
  } catch (err) {
    test.skip(true, `node SPA unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

test(localizedTitle("【dApp 连接与 Provider / DAPP】 真实钱包驱动节点SPA：window.ethereum是YeYing提供商", "real wallet drives node SPA: window.ethereum is the YeYing provider"), async () => {
  skipIfNoNodeSPA();
  const nodeURL = baseURLFor('node')!;
  await ensureNodeReachable(nodeURL);

  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await createAndUnlockWallet(ctx.context, ctx.extensionId);

    // Open the node SPA in a new tab. The extension's content script
    // auto-injects `window.ethereum` (EIP-1193) and fires eip6963:announceProvider.
    const dapp = await ctx.context.newPage();
    await dapp.goto(nodeURL, { waitUntil: 'domcontentloaded' });
    // Element Plus mounts after the SPA bundle loads; wait for the
    // header to actually attach.
    await dapp.waitForLoadState('networkidle');

    await dapp.waitForFunction(
      () => (globalThis as any).ethereum?.isYeYing === true,
      undefined,
      { timeout: 20_000 },
    );
    const flags = await dapp.evaluate(() => {
      const p = (globalThis as any).ethereum;
      return {
        isYeYing: p?.isYeYing,
        isMetaMask: p?.isMetaMask,
        chainId: p?.chainId,
      };
    });
    expect(flags.isYeYing).toBe(true);
    expect(flags.isMetaMask).toBeFalsy();
    expect(flags.chainId).toMatch(/^0x[0-9a-fA-F]+$/);

    // The node SPA's header has a "连接钱包" (zh) / "Connect Wallet" (en)
    // button — the entry point the user clicks to start SIWE. Assert
    // either text matches.
    await expect(
      dapp.locator('header button').filter({ hasText: /连接钱包|Connect Wallet/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  } finally {
    await teardownWalletContext(ctx);
  }
});

test(localizedTitle("【dApp 连接与 Provider / DAPP】 节点可以通过审批窗口请求帐户", "node can request an account via the approval window"), async () => {
  skipIfNoNodeSPA();
  const nodeURL = baseURLFor('node')!;
  await ensureNodeReachable(nodeURL);

  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await createAndUnlockWallet(ctx.context, ctx.extensionId);

    const dapp = await ctx.context.newPage();
    await dapp.goto(nodeURL, { waitUntil: 'domcontentloaded' });
    await dapp.waitForLoadState('networkidle');

    await dapp.waitForFunction(
      () => (globalThis as any).ethereum?.isYeYing === true,
      undefined,
      { timeout: 20_000 },
    );

    // Fire eth_requestAccounts directly — the test doesn't depend on
    // the node SPA's click flow being in a particular state, just on
    // the wallet's approval flow.
    const accountsPromise = dapp.evaluate(async () => {
      try {
        const accs = await (globalThis as any).ethereum.request({ method: 'eth_requestAccounts' });
        return { ok: true, accounts: accs };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    const approval = await waitForApproval(ctx.context, ctx.extensionId, { requestType: 'connect' });
    await approval.locator('#approveConnect').click({ timeout: 10_000 });

    const result = await accountsPromise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0]).toMatch(/^0x[\da-fA-F]{40}$/);
    }
  } finally {
    await teardownWalletContext(ctx);
  }
});

test(localizedTitle("【dApp 连接与 Provider / DAPP】 节点通过 EIP-6963 announceProvider 发现钱包", "node discovers the wallet via EIP-6963 announceProvider"), async () => {
  skipIfNoNodeSPA();
  const nodeURL = baseURLFor('node')!;
  await ensureNodeReachable(nodeURL);

  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await createAndUnlockWallet(ctx.context, ctx.extensionId);

    const dapp = await ctx.context.newPage();
    await dapp.goto(nodeURL, { waitUntil: 'domcontentloaded' });
    await dapp.waitForLoadState('networkidle');

    const info = await dapp.evaluate(
      () =>
        new Promise<any>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('eip6963:announceProvider timed out after 10s')),
            10_000,
          );
          (globalThis as any).addEventListener(
            'eip6963:announceProvider',
            (event: any) => {
              clearTimeout(timer);
              resolve(event.detail?.info ?? null);
            },
            { once: true },
          );
          (globalThis as any).dispatchEvent(new Event('eip6963:requestProvider'));
        }),
    );

    expect(info).not.toBeNull();
    expect(info.name).toBe('YeYing Wallet');
    expect(info.rdns).toBe('io.github.yeying');
    expect(info.uuid).toMatch(/^[0-9a-f-]{36}$/i);
    expect(info.icon).toMatch(/^data:image\/svg\+xml/);
  } finally {
    await teardownWalletContext(ctx);
  }
});
