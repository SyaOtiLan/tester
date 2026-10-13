/**
 * Wallet — popup: network management via the UI.
 *
 * The wallet ships with only its default networks (Ethereum mainnet +
 * YeYing). A user can register a custom network through the network-manage
 * page and then activate it from any network selector. This spec drives
 * that end-to-end through the real popup UI (not the SW message bus that
 * `popup-send-tx` uses for registration):
 *
 *   1. Open the network selector → 网络管理 (manage) page.
 *   2. Add a custom network via the form (#networkFormPage).
 *   3. Confirm it appears in the manage list.
 *   4. Switch to it from a network selector and assert the active label.
 *
 * Selectors verified against `wallet/html/popup.html` and
 * `js/controller/network-controller.js`.
 */
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, createAndUnlockWallet, addCustomNetwork, openTransferPage, sendSw } from '../helpers/popup';

// A distinctive custom network so we can assert on its label unambiguously.
const NET_NAME = 'E2E Testnet';
const NET_RPC = 'https://e2e.example.invalid/rpc';
const NET_CHAIN_ID = '0x539'; // 1337
const NET_SYMBOL = 'E2E';

test("【网络管理 / UI】 通过 UI 添加自定义网络并切换到它", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    // Switching networks calls eth_chainId against the new RPC; an
    // unreachable RPC makes the switch throw and revert. Stub our custom
    // host with a minimal JSON-RPC responder so the switch succeeds
    // without a live dependency.
    await ctx.context.route('https://e2e.example.invalid/**', async (route) => {
      let method = '';
      let id: unknown = 1;
      try {
        const body = route.request().postDataJSON() as { method?: string; id?: unknown };
        method = body?.method ?? '';
        id = body?.id ?? 1;
      } catch {
        // non-JSON body; fall through with defaults
      }
      const result = method === 'eth_getBalance' ? '0x0' : NET_CHAIN_ID;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id, result }),
      });
    });
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);
    await recorder.step(popup, '创建并解锁钱包');

    // Open the tokens-tab network selector and jump into 网络管理.
    const selector = popup.locator('#tokensContent [data-network-selector="true"]').first();
    await selector.locator('.network-trigger').click();
    await popup.locator('#tokensContent .network-menu').waitFor({ state: 'visible' });
    await popup.locator('.network-option-manage').first().click();

    await byId(popup, 'networkManagePage').waitFor({ state: 'visible' });
    await recorder.step(popup, '进入网络管理页');

    // Add a new network.
    await byId(popup, 'networkAddBtn').click();
    await byId(popup, 'networkFormPage').waitFor({ state: 'visible' });
    await byId(popup, 'networkNameInput').fill(NET_NAME);
    await byId(popup, 'networkRpcInput').fill(NET_RPC);
    await byId(popup, 'networkChainIdInput').fill(NET_CHAIN_ID);
    await byId(popup, 'networkSymbolInput').fill(NET_SYMBOL);
    await recorder.step(popup, '填写自定义网络表单');
    await byId(popup, 'saveNetworkBtn').click();

    // Back on the manage page, the new network should be listed.
    await byId(popup, 'networkManagePage').waitFor({ state: 'visible' });
    await expect(
      byId(popup, 'networkManageList').locator('.network-item-title', { hasText: NET_NAME }),
    ).toBeVisible({ timeout: 10_000 });
    await recorder.step(popup, '自定义网络已加入列表');

    // Go back to the wallet page and switch to the new network via a selector.
    await popup.locator('#networkManagePage .back-btn:visible').first().click();
    await byId(popup, 'walletPage').waitFor({ state: 'visible' });

    const sel2 = popup.locator('#tokensContent [data-network-selector="true"]').first();
    await sel2.locator('.network-trigger').click();
    const option = popup.locator(
      `#tokensContent .network-option[data-value="${NET_RPC}"]`,
    );
    await option.waitFor({ state: 'visible', timeout: 5_000 });
    await option.click();
    await recorder.step(popup, '切换到自定义网络');

    await expect(sel2.locator('.network-label')).toHaveText(NET_NAME, { timeout: 5_000 });
  } finally {
    await teardownWalletContext(ctx);
  }
});

// WL-UI-020: switching to a network whose RPC is unreachable must fail
// loudly and leave the active network unchanged (no silent partial switch).
const UNREACHABLE_NAME = 'Unreachable E2E';
const UNREACHABLE_RPC = 'https://unreachable.e2e.invalid/rpc';
const UNREACHABLE_CHAIN_ID = '0x2694'; // 9876

test("【网络管理 / UI】 WL-UI-020 切换到不可达 RPC 网络时失败并回退", async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    // The custom RPC host is unreachable: every request aborts.
    await ctx.context.route(`${UNREACHABLE_RPC}**`, (route) => route.abort('connectionfailed'));
    await ctx.context.route('https://unreachable.e2e.invalid/**', (route) =>
      route.abort('connectionfailed'),
    );

    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);

    // Register the broken network directly (ADD_CUSTOM_NETWORK never calls
    // the RPC, so it stores fine even though the host is dead).
    const added = await addCustomNetwork(popup, {
      chainName: UNREACHABLE_NAME,
      chainId: UNREACHABLE_CHAIN_ID,
      rpcUrl: UNREACHABLE_RPC,
      symbol: 'ETH',
    });
    expect(added.success, `add network failed: ${added.error}`).toBe(true);

    // Entering the transfer page refreshes the selector so the new (broken)
    // network becomes selectable.
    await openTransferPage(popup);
    const selector = popup.locator('#transferPage [data-network-selector="true"]').first();
    const labelBefore = (await selector.locator('.network-label').textContent())?.trim();
    await recorder.step(popup, `当前网络: ${labelBefore}`);

    await selector.locator('.network-trigger').click();
    const option = selector.locator(`.network-option[data-value="${UNREACHABLE_RPC}"]`);
    await option.waitFor({ state: 'visible', timeout: 5_000 });
    await option.click();
    await recorder.step(popup, '尝试切换到不可达网络');

    // The switch throws → error toast, and the active label is unchanged.
    await expect(byId(popup, 'globalToast')).toContainText('切换网络失败', { timeout: 15_000 });
    await expect
      .poll(async () => (await selector.locator('.network-label').textContent())?.trim(), {
        timeout: 5_000,
      })
      .toBe(labelBefore);
    await recorder.step(popup, '切换失败，网络回退到原网络');
  } finally {
    await teardownWalletContext(ctx);
  }
});

/**
 * Open the network-manage page (`#networkManagePage`) from the tokens-tab
 * network selector. Mirrors the navigation used by the "add a custom network"
 * test above.
 */
async function openNetworkManage(popup: import('@playwright/test').Page): Promise<void> {
  const selector = popup.locator('#tokensContent [data-network-selector="true"]').first();
  await selector.locator('.network-trigger').click();
  await popup.locator('#tokensContent .network-menu').waitFor({ state: 'visible' });
  await popup.locator('.network-option-manage').first().click();
  await byId(popup, 'networkManagePage').waitFor({ state: 'visible' });
}

// WL-UI-017: editing an existing custom network updates its fields in the
// manage list and the selectors, and switching to it shows the new name.
test("【网络管理 / UI】 WL-UI-017 编辑已有自定义网络", async ({
  recorder,
}) => {
  const ORIG_NAME = 'Editable E2E';
  const NEW_NAME = 'Edited E2E';
  const RPC = 'https://edit-net.e2e.invalid/rpc';
  const CHAIN_ID = '0x539'; // 1337

  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    // The edited network is activated at the end, which calls eth_chainId
    // against its RPC — respond so the switch succeeds.
    await ctx.context.route('https://edit-net.e2e.invalid/**', async (route) => {
      let method = '';
      let id: unknown = 1;
      try {
        const body = route.request().postDataJSON() as { method?: string; id?: unknown };
        method = body?.method ?? '';
        id = body?.id ?? 1;
      } catch {
        /* non-JSON body */
      }
      const result = method === 'eth_getBalance' ? '0x0' : CHAIN_ID;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id, result }),
      });
    });

    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);
    // Register the network directly, then edit it through the UI.
    const added = await addCustomNetwork(popup, { chainName: ORIG_NAME, chainId: CHAIN_ID, rpcUrl: RPC, symbol: 'OLD' });
    expect(added.success, `add network failed: ${added.error}`).toBe(true);

    await openNetworkManage(popup);
    await recorder.step(popup, '进入网络管理页');

    // Click the network row (not its delete button) → edit form.
    const item = popup
      .locator('#networkManageList .network-item')
      .filter({ has: popup.locator('.network-item-title', { hasText: ORIG_NAME }) })
      .first();
    await item.waitFor({ state: 'visible', timeout: 10_000 });
    await item.click();

    await byId(popup, 'networkFormPage').waitFor({ state: 'visible' });
    // Chain ID is locked when editing an existing network.
    await expect(byId(popup, 'networkChainIdInput')).toBeDisabled();
    await byId(popup, 'networkNameInput').fill(NEW_NAME);
    await byId(popup, 'networkSymbolInput').fill('NEW');
    await recorder.step(popup, '修改网络名称与符号');
    await byId(popup, 'saveNetworkBtn').click();

    // Back on the manage page, the row reflects the new name (and the old is gone).
    await byId(popup, 'networkManagePage').waitFor({ state: 'visible' });
    await expect(
      byId(popup, 'networkManageList').locator('.network-item-title', { hasText: NEW_NAME }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      byId(popup, 'networkManageList').locator('.network-item-title', { hasText: ORIG_NAME }),
    ).toHaveCount(0);
    await recorder.step(popup, '列表反映更新后的名称');

    // Switch to the edited network from a selector → active label is the new name.
    await popup.locator('#networkManagePage .back-btn:visible').first().click();
    await byId(popup, 'walletPage').waitFor({ state: 'visible' });
    const sel = popup.locator('#tokensContent [data-network-selector="true"]').first();
    await sel.locator('.network-trigger').click();
    const option = popup.locator(`#tokensContent .network-option[data-value="${RPC}"]`);
    await option.waitFor({ state: 'visible', timeout: 5_000 });
    await option.click();
    await expect(sel.locator('.network-label')).toHaveText(NEW_NAME, { timeout: 5_000 });
    await recorder.step(popup, '切换后标签为新名称');
  } finally {
    await teardownWalletContext(ctx);
  }
});

// WL-UI-018: deleting a custom network removes it from the manage list and
// every selector, without touching the default networks.
test("【网络管理 / UI】 WL-UI-018 删除自定义网络", async ({
  recorder,
}) => {
  const NAME = 'Deletable E2E';
  const RPC = 'https://delete-net.e2e.invalid/rpc';
  const CHAIN_ID = '0x2711'; // 10001

  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);

    const added = await addCustomNetwork(popup, { chainName: NAME, chainId: CHAIN_ID, rpcUrl: RPC });
    expect(added.success, `add network failed: ${added.error}`).toBe(true);

    await openNetworkManage(popup);
    await expect(
      byId(popup, 'networkManageList').locator('.network-item-title', { hasText: NAME }),
    ).toBeVisible({ timeout: 10_000 });
    await recorder.step(popup, '自定义网络在管理列表中');

    // Delete uses a native confirm() — auto-accept it.
    popup.on('dialog', (dialog) => dialog.accept().catch(() => {}));
    const item = popup
      .locator('#networkManageList .network-item')
      .filter({ has: popup.locator('.network-item-title', { hasText: NAME }) })
      .first();
    await item.locator('.btn-danger').click();

    await expect(byId(popup, 'globalToast')).toContainText('网络已删除', { timeout: 10_000 });
    await expect(
      byId(popup, 'networkManageList').locator('.network-item-title', { hasText: NAME }),
    ).toHaveCount(0, { timeout: 10_000 });
    // The default YeYing network survives the delete.
    await expect(
      byId(popup, 'networkManageList').locator('.network-item-title', { hasText: /YeYing/i }),
    ).toBeVisible();
    await recorder.step(popup, '自定义网络已删除，默认网络不受影响');

    // It is gone from the transfer-page selector too.
    await popup.locator('#networkManagePage .back-btn:visible').first().click();
    await byId(popup, 'walletPage').waitFor({ state: 'visible' });
    await openTransferPage(popup);
    const selector = popup.locator('#transferPage [data-network-selector="true"]').first();
    await selector.locator('.network-trigger').click();
    await expect(selector.locator(`.network-option[data-value="${RPC}"]`)).toHaveCount(0);
  } finally {
    await teardownWalletContext(ctx);
  }
});

// WL-UI-019: a brand-new wallet ships with built-in networks (Ethereum +
// YeYing) that can be switched between; the label and chainId follow.
test("【网络管理 / UI】 WL-UI-019 默认网络存在且可切换", async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    // The two default RPCs are otherwise aborted by stubPublicEndpoints;
    // override them so a switch's eth_chainId probe succeeds. Later routes
    // take priority in Playwright.
    const respondChainId =
      (chainIdHex: string) => async (route: import('@playwright/test').Route) => {
        let method = '';
        let id: unknown = 1;
        try {
          const body = route.request().postDataJSON() as { method?: string; id?: unknown };
          method = body?.method ?? '';
          id = body?.id ?? 1;
        } catch {
          /* non-JSON body */
        }
        const result = method === 'eth_getBalance' ? '0x0' : chainIdHex;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ jsonrpc: '2.0', id, result }),
        });
      };
    await ctx.context.route('https://ethereum-rpc.publicnode.com/**', respondChainId('0x1'));
    await ctx.context.route('https://blockchain.yeying.pub/**', respondChainId('0x1538'));

    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);
    await recorder.step(popup, '创建全新钱包');

    // Open the tokens-tab selector and confirm the built-in networks.
    const selector = popup.locator('#tokensContent [data-network-selector="true"]').first();
    await selector.locator('.network-trigger').click();
    await popup.locator('#tokensContent .network-menu').waitFor({ state: 'visible' });
    await expect(
      popup.locator('#tokensContent .network-option', { hasText: 'Ethereum Mainnet' }),
    ).toBeVisible();
    await expect(
      popup.locator('#tokensContent .network-option', { hasText: 'YeYing Mainnet' }),
    ).toBeVisible();
    await recorder.step(popup, '内置网络含 Ethereum 与 YeYing');

    // Default chainId is YeYing (0x1538). Switch to Ethereum and assert both
    // the label and the SW-reported chainId change.
    const before = (await sendSw(popup, 'GET_CURRENT_CHAIN_ID')) as { chainId?: string };
    expect(before.chainId?.toLowerCase()).toBe('0x1538');

    await popup
      .locator('#tokensContent .network-option', { hasText: 'Ethereum Mainnet' })
      .first()
      .click();
    await expect(selector.locator('.network-label')).toHaveText('Ethereum Mainnet', {
      timeout: 10_000,
    });
    await expect
      .poll(
        async () =>
          ((await sendSw(popup, 'GET_CURRENT_CHAIN_ID')) as { chainId?: string }).chainId?.toLowerCase(),
        { timeout: 10_000 },
      )
      .toBe('0x1');
    await recorder.step(popup, '切换到以太坊主网,标签与 chainId 变化');

    // Switch back to YeYing to prove the toggle both ways.
    await selector.locator('.network-trigger').click();
    await popup
      .locator('#tokensContent .network-option', { hasText: 'YeYing Mainnet' })
      .first()
      .click();
    await expect(selector.locator('.network-label')).toHaveText('YeYing Mainnet', { timeout: 10_000 });
    await expect
      .poll(
        async () =>
          ((await sendSw(popup, 'GET_CURRENT_CHAIN_ID')) as { chainId?: string }).chainId?.toLowerCase(),
        { timeout: 10_000 },
      )
      .toBe('0x1538');
  } finally {
    await teardownWalletContext(ctx);
  }
});
