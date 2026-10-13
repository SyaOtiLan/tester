/**
 * Wallet — popup: clear transaction history (WL-UI-030).
 *
 * Transactions live in the SW's IndexedDB, so we seed one by making a *real*
 * send against a stubbed node (the stub returns `keccak256(rawTx)` for
 * `eth_sendRawTransaction`, satisfying ethers' broadcast-hash check without a
 * live chain — same approach as popup-tx-detail.spec.ts). Then we clear the
 * list from the activity tab and assert it empties behind a confirm guard.
 *
 * Verified against `js/controller/transaction/transaction-list-controller.js`
 * (`#clearTransactionsBtn` → `handleClearTransactions` → native `confirm()` →
 * `clearTransactions` → renders empty + `showSuccess('交易记录已清除')`).
 */
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { routeRpcNode } from '../helpers/rpc';
import {
  addCustomNetwork,
  byId,
  createAndUnlockWallet,
  openTransferPage,
  pickTransferNetwork,
  TEST_PASSWORD,
} from '../helpers/popup';

const NET_NAME = 'Clear E2E';
const NET_RPC = 'https://tx-clear.e2e.invalid/rpc';
const NET_CHAIN_ID = '0x539'; // 1337
const BURN_ADDRESS = '0x0000000000000000000000000000000000000001';

test("【转账与交易 / UI】 WL-UI-030 清空交易历史", async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await routeRpcNode(ctx.context, 'https://tx-clear.e2e.invalid/**', {
      chainId: NET_CHAIN_ID,
      balanceWei: '0x8ac7230489e80000', // 10 ETH
    });

    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);
    const added = await addCustomNetwork(popup, {
      chainName: NET_NAME,
      chainId: NET_CHAIN_ID,
      rpcUrl: NET_RPC,
    });
    expect(added.success, `add network failed: ${added.error}`).toBe(true);

    // Seed a transaction with a real send.
    await openTransferPage(popup);
    const selector = await pickTransferNetwork(popup, NET_RPC);
    await expect(selector.locator('.network-label')).toHaveText(NET_NAME, { timeout: 5_000 });
    await byId(popup, 'recipientAddress').fill(BURN_ADDRESS);
    await byId(popup, 'amount').fill('0.001');
    await recorder.step(popup, '发起一笔转账以生成交易记录');
    await byId(popup, 'sendBtn').click();

    const prompt = popup.locator('#passwordPromptModal');
    if (await prompt.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)) {
      await popup.locator('#passwordPromptInput').fill(TEST_PASSWORD);
      await popup.locator('#passwordPromptConfirm').click();
    }
    await expect(byId(popup, 'globalWaitingOverlay')).toBeHidden({ timeout: 60_000 });

    // Switch to the activity tab where the list + clear button live.
    await popup.locator('#activityTab').click();
    await byId(popup, 'transactionList').waitFor({ state: 'visible', timeout: 10_000 });
    const txItem = popup
      .locator('#transactionList .transaction-item[data-tx-hash]:not([data-tx-hash=""])')
      .first();
    await txItem.waitFor({ state: 'visible', timeout: 30_000 });
    await recurringActivityAssertion(popup);
    await recorder.step(popup, '活动列表已有一笔交易');

    // Clearing goes through a native confirm() — reject the first time to
    // prove the guard, then accept and verify the list empties.
    let dialogMessage = '';
    popup.once('dialog', (dialog) => {
      dialogMessage = dialog.message();
      dialog.dismiss().catch(() => {});
    });
    await byId(popup, 'clearTransactionsBtn').click();
    await expect.poll(() => dialogMessage).toContain('清除');
    // Dismissed → nothing cleared.
    await expect(
      popup.locator('#transactionList .transaction-item[data-tx-hash]:not([data-tx-hash=""])'),
    ).toHaveCount(1);
    await recorder.step(popup, '取消确认框,记录保留');

    // Now accept the confirm and clear for real.
    popup.once('dialog', (dialog) => dialog.accept().catch(() => {}));
    await byId(popup, 'clearTransactionsBtn').click();
    await expect(byId(popup, 'globalToast')).toContainText('交易记录已清除', { timeout: 10_000 });
    await expect(byId(popup, 'transactionList')).toContainText('暂无交易记录', { timeout: 10_000 });
    await expect(
      popup.locator('#transactionList .transaction-item[data-tx-hash]:not([data-tx-hash=""])'),
    ).toHaveCount(0);
    await recorder.step(popup, '确认后交易列表已清空');
  } finally {
    await teardownWalletContext(ctx);
  }
});

/** Assert exactly one seeded transaction is present before clearing. */
async function recurringActivityAssertion(popup: import('@playwright/test').Page): Promise<void> {
  await expect(
    popup.locator('#transactionList .transaction-item[data-tx-hash]:not([data-tx-hash=""])'),
  ).toHaveCount(1, { timeout: 30_000 });
}
