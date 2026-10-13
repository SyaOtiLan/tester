/**
 * Wallet — dApp integration: eth_accounts + accountsChanged
 * (WL-DAPP-018, WL-DAPP-017).
 *
 *   WL-DAPP-018  Before any connection, `eth_accounts` returns [] (it never
 *                triggers an approval and never leaks the wallet's address to
 *                an un-authorized origin).
 *
 *   WL-DAPP-017  After a dApp connects, switching the active account in the
 *                popup broadcasts `accountsChanged` to the connected page with
 *                the new account's address (js/background/operations/wallet.js
 *                → handleSwitchAccount → broadcastEvent(ACCOUNTS_CHANGED); the
 *                injected provider re-emits it, see inject.js
 *                → _handleAccountsChanged).
 */
import { test, expect } from '../fixtures';
import type { BrowserContext, Page } from '@playwright/test';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, createAndUnlockWallet, waitForApproval, TEST_PASSWORD } from '../helpers/popup';

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

/** Fill the on-demand password prompt if the account switch asks for it. */
async function fillPasswordPromptIfShown(popup: Page) {
  const modal = popup.locator('#passwordPromptModal');
  const shown = await modal
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (shown) {
    await popup.locator('#passwordPromptInput').fill(TEST_PASSWORD);
    await popup.locator('#passwordPromptConfirm').click();
    await modal.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
  }
}

test("【dApp 连接与 Provider / DAPP】 WL-DAPP-018 未连接时 `eth_accounts` 返回空数组", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await serveBlankDapp(ctx.context);
    await createAndUnlockWallet(ctx.context, ctx.extensionId);
    const dapp = await openDapp(ctx.context);

    // No connection has been made → no authorization → empty list, no window.
    const accounts = await dapp.evaluate(() =>
      (globalThis as any).ethereum.request({ method: 'eth_accounts' }),
    );
    expect(accounts).toEqual([]);
    await recorder.step(dapp, '未连接时 eth_accounts 返回空数组');
  } finally {
    await teardownWalletContext(ctx);
  }
});

test("【dApp 连接与 Provider / DAPP】 WL-DAPP-017 连接后切换账户触发 accountsChanged", async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await serveBlankDapp(ctx.context);
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);
    const dapp = await openDapp(ctx.context);

    // Connect + record accountsChanged events on the dApp side.
    const connectPromise = dapp.evaluate(() =>
      (globalThis as any).ethereum.request({ method: 'eth_requestAccounts' }),
    );
    const approval = await waitForApproval(ctx.context, ctx.extensionId, { requestType: 'connect' });
    await approval.locator('#approveConnect').click({ timeout: 10_000 });
    const accounts = (await connectPromise) as string[];
    const accountA = accounts[0].toLowerCase();
    expect(accountA).toMatch(/^0x[\da-fA-F]{40}$/);

    await dapp.evaluate(() => {
      (globalThis as any).__acctEvents = [];
      (globalThis as any).ethereum.on('accountsChanged', (a: string[]) =>
        (globalThis as any).__acctEvents.push(a),
      );
    });
    await recorder.step(dapp, 'dApp 已连接,监听 accountsChanged');

    // In the popup: add a second HD account and switch to it.
    await popup.bringToFront();
    await byId(popup, 'accountHeader').click();
    await byId(popup, 'accountSwitcherMenu').waitFor({ state: 'visible' });
    await byId(popup, 'manageAccountsBtn').click();
    await byId(popup, 'accountsPage').waitFor({ state: 'visible' });
    await popup.locator('#walletList .add-account-item').first().click();
    await byId(popup, 'createAccountModal').waitFor({ state: 'visible' });
    await byId(popup, 'newAccountName').fill('E2E Second');
    await byId(popup, 'confirmCreateAccount').click();
    await fillPasswordPromptIfShown(popup);
    await byId(popup, 'createAccountModal').waitFor({ state: 'hidden', timeout: 10_000 });

    if (!(await byId(popup, 'accountsPage').isVisible())) {
      if (!(await byId(popup, 'walletPage').isVisible())) {
        await popup.locator('#accountsPage .back-btn:visible').first().click().catch(() => {});
      }
      await byId(popup, 'walletPage').waitFor({ state: 'visible' });
      await byId(popup, 'accountHeader').click();
      await byId(popup, 'accountSwitcherMenu').waitFor({ state: 'visible' });
      await byId(popup, 'manageAccountsBtn').click();
      await byId(popup, 'accountsPage').waitFor({ state: 'visible' });
    }
    await expect(popup.locator('#walletList .account-item')).toHaveCount(2, { timeout: 10_000 });
    await recorder.step(popup, '新增第二个账户');

    // Switch to the second account from the header switcher.
    if (!(await byId(popup, 'walletPage').isVisible())) {
      await popup.locator('#accountsPage .back-btn:visible').first().click();
    }
    await byId(popup, 'walletPage').waitFor({ state: 'visible' });
    await byId(popup, 'accountHeader').click();
    await byId(popup, 'accountSwitcherMenu').waitFor({ state: 'visible' });
    await popup
      .locator('#accountSwitcherList .account-switcher-item:not(.active)')
      .first()
      .click();
    await fillPasswordPromptIfShown(popup);
    await recorder.step(popup, '切换到第二个账户');

    // The connected dApp receives an accountsChanged carrying a different
    // account address than the one it originally connected with.
    await dapp.bringToFront();
    const differentAccountSeen = async () => {
      const events = (await dapp.evaluate(
        () => (globalThis as any).__acctEvents as string[][],
      )) as string[][];
      return events.some(
        (ev) =>
          Array.isArray(ev) &&
          typeof ev[0] === 'string' &&
          /^0x[\da-fA-F]{40}$/.test(ev[0]) &&
          ev[0].toLowerCase() !== accountA,
      );
    };
    await expect.poll(differentAccountSeen, { timeout: 15_000 }).toBe(true);
    await recorder.step(dapp, 'dApp 收到 accountsChanged(新账户地址)');
  } finally {
    await teardownWalletContext(ctx);
  }
});
