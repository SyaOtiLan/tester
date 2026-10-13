/**
 * Wallet — popup: transaction detail page (WL-UI-029).
 *
 * Transactions live in the SW's IndexedDB, so we can't seed one from the
 * popup — we make a *real* send against a stubbed node (the stub returns
 * `keccak256(rawTx)` for `eth_sendRawTransaction`, satisfying ethers'
 * broadcast hash check without a live chain), then open the resulting item
 * from the activity list and assert the detail page renders its fields.
 *
 * Verified against `js/controller/transaction/transaction-list-controller.js`
 * (`.transaction-item[data-tx-hash]` → `openTransactionDetail`) and
 * `js/controller/transaction/transaction-detail-controller.js`
 * (`#txDetailHash` / `#txDetailTo` carry the full value in their `title`).
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

const NET_NAME = 'Detail E2E';
const NET_RPC = 'https://tx-detail.e2e.invalid/rpc';
const NET_CHAIN_ID = '0x539'; // 1337
const BURN_ADDRESS = '0x0000000000000000000000000000000000000001';

test("【转账与交易 / UI】 WL-UI-029 交易详情页展示", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    // Fund the account generously so the send goes through; the stub echoes
    // the real keccak hash back for the broadcast.
    await routeRpcNode(ctx.context, 'https://tx-detail.e2e.invalid/**', {
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

    // The activity list should now hold a tx item with a real hash.
    const txItem = popup
      .locator('#transactionList .transaction-item[data-tx-hash]:not([data-tx-hash=""])')
      .first();
    await txItem.waitFor({ state: 'visible', timeout: 30_000 });
    const txHash = await txItem.getAttribute('data-tx-hash');
    expect(txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    await recorder.step(popup, '交易出现在活动列表');

    // Open the detail page and assert its fields.
    await txItem.click();
    await popup.locator('#transactionDetailPage').waitFor({ state: 'visible', timeout: 10_000 });
    await expect(popup.locator('#txDetailHash')).toHaveAttribute('title', txHash!, {
      timeout: 10_000,
    });
    await expect(popup.locator('#txDetailTo')).toHaveAttribute(
      'title',
      new RegExp(BURN_ADDRESS, 'i'),
    );
    await expect(popup.locator('#txDetailStatus')).toBeVisible();
    await recorder.step(popup, '交易详情页展示完整信息');
  } finally {
    await teardownWalletContext(ctx);
  }
});
