/**
 * Wallet — dApp integration: real wallet extension drives the router SPA.
 *
 * Mirrors `dapp-warehouse.spec.ts`. The router SPA is React + Ant Design
 * with a single "Wallet Login" button at the landing page (probed on
 * 2026-09-13 — title "Router", no admin shell, single-page). The wallet
 * injects `window.ethereum` and the dApp calls `eth_requestAccounts` →
 * the wallet shows an approval window → user approves → SIWE handshake
 * starts.
 *
 * Each test:
 *
 *   1. Launches a persistent Chromium context with the wallet loaded.
 *   2. Stubs the wallet's default public endpoints.
 *   3. Creates + unlocks a wallet in the popup.
 *   4. Opens the router SPA, asserts the wallet injected itself
 *      (`window.ethereum.isYeYing === true`).
 *   5. Exercises either provider discovery or the approval flow.
 *
 * Skips if `ROUTER_BASE_URL` is unset or the SPA doesn't respond.
 */
import { test, expect, baseURLFor } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { createAndUnlockWallet, waitForApproval } from '../helpers/popup';

function skipIfNoRouterSPA() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}

async function ensureRouterReachable(url: string) {
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5_000) });
    test.skip(res.status >= 500, `router SPA returned HTTP ${res.status}`);
  } catch (err) {
    test.skip(true, `router SPA unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

test("【dApp 连接与 Provider / DAPP】 真实钱包驱动路由器SPA：window.ethereum是YeYing提供商", async () => {
  skipIfNoRouterSPA();
  const routerURL = baseURLFor('router')!;
  await ensureRouterReachable(routerURL);

  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await createAndUnlockWallet(ctx.context, ctx.extensionId);

    // Open the router SPA in a new tab. The extension's content script
    // auto-injects `window.ethereum` (EIP-1193) and fires eip6963:announceProvider.
    const dapp = await ctx.context.newPage();
    await dapp.goto(routerURL, { waitUntil: 'domcontentloaded' });

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

    // The router's "Wallet Login" button must be visible — that's the
    // entry point the user clicks to start SIWE.
    await expect(dapp.locator('.ant-btn').filter({ hasText: 'Wallet Login' })).toBeVisible({
      timeout: 10_000,
    });
  } finally {
    await teardownWalletContext(ctx);
  }
});

test("【dApp 连接与 Provider / DAPP】 路由器可以通过批准窗口请求帐户", async () => {
  skipIfNoRouterSPA();
  const routerURL = baseURLFor('router')!;
  await ensureRouterReachable(routerURL);

  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await createAndUnlockWallet(ctx.context, ctx.extensionId);

    const dapp = await ctx.context.newPage();
    await dapp.goto(routerURL, { waitUntil: 'domcontentloaded' });

    await dapp.waitForFunction(
      () => (globalThis as any).ethereum?.isYeYing === true,
      undefined,
      { timeout: 20_000 },
    );

    // Fire eth_requestAccounts directly — the test doesn't depend on
    // the router SPA's click flow being in a particular state, just on
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

test("【dApp 连接与 Provider / DAPP】 路由器通过 EIP-6963 announceProvider 发现钱包", async () => {
  skipIfNoRouterSPA();
  const routerURL = baseURLFor('router')!;
  await ensureRouterReachable(routerURL);

  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await createAndUnlockWallet(ctx.context, ctx.extensionId);

    const dapp = await ctx.context.newPage();
    await dapp.goto(routerURL, { waitUntil: 'domcontentloaded' });

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