/**
 * Wallet — dApp integration: real wallet extension drives the warehouse SPA.
 *
 * Track B of the wallet e2e rollout. Each test:
 *
 *   1. Launches a persistent Chromium context with the wallet extension
 *      loaded (`loadWalletContext`).
 *   2. Stubs the wallet's default public endpoints so it doesn't block on
 *      balance/RPC calls.
 *   3. Creates + unlocks a wallet in the popup so the dApp can use it.
 *   4. Opens the warehouse SPA in a new tab — the extension's content
 *      script auto-injects `window.ethereum` (YeYing provider).
 *   5. Exercises a real EIP-1193 / EIP-6963 flow.
 *
 * Why these tests don't replace the warehouse shim (`ui-wallet.spec.ts`):
 * the shim still gives hermetic, parallel-safe coverage for warehouse's
 * own error paths. These tests add real-wallet coverage on top.
 *
 * Both tests skip if the warehouse SPA isn't reachable — the warehouse
 * e2e (which depends on it) already skips the same way.
 */
import { test, expect, baseURLFor } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { waitForApproval } from '../helpers/popup';

const TEST_PASSWORD = 'E2E-password-2026';
const TEST_WALLET_NAME = 'E2E Wallet';

function skipIfNoWarehouseSPA() {
  test.skip(!baseURLFor('warehouse'), 'WAREHOUSE_BASE_URL not configured');
}

async function ensureWarehouseReachable(url: string) {
  // Quick liveness probe so we get a clean skip reason rather than a 30s
  // navigation timeout if warehouse is down.
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5_000) });
    test.skip(res.status >= 500, `warehouse SPA returned HTTP ${res.status}`);
  } catch (err) {
    test.skip(true, `warehouse SPA unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function createAndUnlockWalletInPopup(
  ctx: Awaited<ReturnType<typeof loadWalletContext>>,
) {
  const popup = await ctx.context.newPage();
  await popup.setViewportSize({ width: 380, height: 600 });
  await popup.goto(`chrome-extension://${ctx.extensionId}/html/popup.html`);

  await popup.locator('#welcomePage').waitFor({ state: 'visible' });
  await popup.locator('#welcomeCreateWalletBtn').click();
  await popup.locator('#setPasswordPage').waitFor({ state: 'visible' });
  await popup.locator('#setWalletName').fill(TEST_WALLET_NAME);
  await popup.locator('#setPasswordBtn').click();
  await popup.locator('#passwordPromptInput').fill(TEST_PASSWORD);
  await popup.locator('#passwordPromptConfirm').click();
  await popup.locator('#walletPage').waitFor({ state: 'visible', timeout: 30_000 });
  return popup;
}

test("【dApp 连接与 Provider / DAPP】 真实钱包驱动仓库SPA：window.ethereum是YeYing提供商", async () => {
  skipIfNoWarehouseSPA();
  const warehouseURL = baseURLFor('warehouse')!;
  await ensureWarehouseReachable(warehouseURL);

  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await createAndUnlockWalletInPopup(ctx);

    // Open the warehouse SPA in a new tab. The extension's content script
    // auto-injects `window.ethereum` (EIP-1193) and fires `eip6963:announceProvider`.
    const dapp = await ctx.context.newPage();
    await dapp.goto(warehouseURL, { waitUntil: 'domcontentloaded' });

    // The YeYing provider is identifiable by isYeYing=true. The warehouse
    // shim uses isMetaMask=true (and exposes __E2E_SHIM__=true) — the
    // real extension exposes neither, so this assertion doubles as proof
    // that no shim has clobbered the real provider.
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
        hasShim: p?.__E2E_SHIM__ === true,
        chainId: p?.chainId,
      };
    });
    expect(flags.isYeYing).toBe(true);
    expect(flags.hasShim).toBe(false);
    // Real provider should still report a chainId (default YeYing = 0x1538).
    expect(flags.chainId).toMatch(/^0x[0-9a-fA-F]+$/);
  } finally {
    await teardownWalletContext(ctx);
  }
});

test("【dApp 连接与 Provider / DAPP】 仓库可以通过审批窗口申请账户", async () => {
  skipIfNoWarehouseSPA();
  const warehouseURL = baseURLFor('warehouse')!;
  await ensureWarehouseReachable(warehouseURL);

  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await createAndUnlockWalletInPopup(ctx);

    const dapp = await ctx.context.newPage();
    await dapp.goto(warehouseURL, { waitUntil: 'domcontentloaded' });

    await dapp.waitForFunction(
      () => (globalThis as any).ethereum?.isYeYing === true,
      undefined,
      { timeout: 20_000 },
    );

    // Trigger eth_requestAccounts in the page. We do this directly so the
    // test doesn't depend on warehouse's UI being in a particular state
    // — what we're proving is that approval flow works end-to-end.
    const accountsPromise = dapp.evaluate(async () => {
      try {
        const accs = await (globalThis as any).ethereum.request({ method: 'eth_requestAccounts' });
        return { ok: true, accounts: accs };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    // The wallet opens an approval window — capture it and approve.
    const approval = await waitForApproval(ctx.context, ctx.extensionId, { requestType: 'connect' });
    // The approval HTML lives in approval.html; the connect view has its
    // own confirm button. Selector name comes from the wallet repo's
    // approval view (#approveConnect is the canonical id).
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

test("【dApp 连接与 Provider / DAPP】 仓库通过 EIP-6963 announceProvider 发现钱包", async () => {
  skipIfNoWarehouseSPA();
  const warehouseURL = baseURLFor('warehouse')!;
  await ensureWarehouseReachable(warehouseURL);

  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await createAndUnlockWalletInPopup(ctx);

    const dapp = await ctx.context.newPage();
    await dapp.goto(warehouseURL, { waitUntil: 'domcontentloaded' });

    // EIP-6963: dispatch the request event, wait for the announce event
    // to come back. The wallet injects itself once and announces on every
    // subsequent request, so this is reliable.
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
    // Icon is a data: URI (the wallet ships an inline SVG).
    expect(info.icon).toMatch(/^data:image\/svg\+xml/);
  } finally {
    await teardownWalletContext(ctx);
  }
});