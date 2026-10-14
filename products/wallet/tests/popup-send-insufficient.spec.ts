/**
 * Wallet — popup: sending more than the balance is rejected (WL-UI-028).
 *
 * The transfer form validates the recipient and a positive amount locally,
 * then hands off to the background signer, which populates the tx via ethers
 * (`eth_estimateGas`). We stub that RPC to return the node's real
 * "insufficient funds" error, so the broadcast never happens and the popup
 * surfaces '发送失败: 余额不足…' — the genuine insufficient-funds path.
 *
 * Verified against `js/controller/transaction/transaction-send-controller.js`
 * (`formatTransactionError`: 'insufficient funds' → '余额不足…') and
 * `js/background/signing.js` (ethers `sendTransaction` populates gas).
 *
 * Hermetic: a stubbed custom network stands in for a live chain (see
 * `helpers/rpc.ts`).
 */
import { localizedTitle } from '../../../shared/title';
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

const NET_NAME = 'Insufficient E2E';
const NET_RPC = 'https://send-insufficient.e2e.invalid/rpc';
const NET_CHAIN_ID = '0x539'; // 1337
const BURN_ADDRESS = '0x0000000000000000000000000000000000000001';

test(localizedTitle("【转账与交易 / UI】 WL-UI-028 金额超过余额 / 余额不足提示", "WL-UI-028: sending more than the balance surfaces an insufficient-funds error"), async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    // The stub returns a zero balance and fails gas estimation the way a
    // real node would when value + fee exceeds the balance.
    await routeRpcNode(ctx.context, 'https://send-insufficient.e2e.invalid/**', {
      chainId: NET_CHAIN_ID,
      balanceWei: '0x0',
      estimateGasError: 'insufficient funds for gas * price + value',
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
    await recorder.step(popup, '切换到测试网络（余额为 0）');

    // Try to send 1 ETH from a zero-balance account.
    await byId(popup, 'recipientAddress').fill(BURN_ADDRESS);
    await byId(popup, 'amount').fill('1');
    await recorder.step(popup, '填写超过余额的转账金额');
    await byId(popup, 'sendBtn').click();

    // The send may re-prompt for the password before signing.
    const prompt = popup.locator('#passwordPromptModal');
    if (await prompt.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)) {
      await popup.locator('#passwordPromptInput').fill(TEST_PASSWORD);
      await popup.locator('#passwordPromptConfirm').click();
    }

    // The failure surfaces as a toast; no tx is broadcast.
    await expect(byId(popup, 'globalToast')).toContainText('余额不足', { timeout: 20_000 });
    // Stay on the transfer page (the send did not succeed).
    await expect(byId(popup, 'transferPage')).toBeVisible();
    await recorder.step(popup, '余额不足被拦截');
  } finally {
    await teardownWalletContext(ctx);
  }
});
