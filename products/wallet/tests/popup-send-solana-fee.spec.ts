/**
 * Wallet — popup: Solana-mode fee estimate shows SOL units (not ETH).
 *
 * Mirrors the Tron fee-estimate spec but exercises the Solana branch
 * in `TransactionSendController.updateFeeEstimate`. The Solana path
 * never calls `eth_estimateGas` / `eth_gasPrice`; it short-circuits
 * with a fixed "base fee = 5000 lamports per signature" placeholder
 * displayed in SOL units.
 *
 * Flow:
 *   1. Stub public YeYing endpoints (so the wallet doesn't stall on the
 *      EVM keyring-init balance fetch).
 *   2. Import the Hardhat/Anvil secp256k1 account #0 as a Solana
 *      private-key wallet.
 *   3. Switch the active network to `solanaMainnet`.
 *   4. Open the transfer page and verify the fee estimate element
 *      contains "SOL" — not "ETH" — and never reads as "-" or
 *      "预估中...".
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, openPopup, sendSw, selectImportNetwork } from '../helpers/popup';

const TEST_SOLANA_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_PASSWORD = 'E2E-password-2026';

test(localizedTitle("【转账与交易 / UI】 Solana-模式费用估算显示 SOL 单位，而不是 ETH", "Solana-mode fee estimate shows SOL units, not ETH"), async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);

    const popup = await openPopup(ctx.context, ctx.extensionId);

    // -- Step 1: import the Hardhat account #0 as a Solana private-key wallet --
    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });
    await byId(popup, 'welcomeImportWalletBtn').click();
    await byId(popup, 'importPage').waitFor({ state: 'visible' });
    await selectImportNetwork(popup, 'solana', 'privateKey');
    await byId(popup, 'importPrivateKey').fill(TEST_SOLANA_PRIVATE_KEY);
    await byId(popup, 'importAccountName').fill('E2E Solana Fee');
    await byId(popup, 'importWalletPassword').fill(TEST_PASSWORD);
    await byId(popup, 'importBtn').click();
    await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 30_000 });

    // -- Step 2: switch to Solana mainnet -------------------------------------
    await sendSw(popup, 'SWITCH_NETWORK', { networkKey: 'solanaMainnet' });

    // -- Step 3: open the transfer screen and verify fee text -----------------
    await byId(popup, 'transferBtn').click();
    await byId(popup, 'transferPage').waitFor({ state: 'visible' });

    // Fill a valid Solana recipient + amount so the fee estimate recomputes with
    // the Solana chain reliably detected (on an empty form right after a
    // programmatic SWITCH_NETWORK the client chain cache can still read as EVM
    // until it warms, showing "-"). The Solana branch resolves to a fixed
    // SOL-denominated placeholder — no RPC needed.
    await byId(popup, 'recipientAddress').fill('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
    await byId(popup, 'amount').fill('0.1');

    await byId(popup, 'transferFeeEstimate').waitFor({ state: 'visible' });
    // The Solana branch short-circuits to a fixed SOL-denominated string
    // (5000 lamports per signature ≈ 0.000005 SOL).
    await expect(byId(popup, 'transferFeeEstimate')).toHaveText(/SOL/);
    await expect(byId(popup, 'transferFeeEstimate')).not.toHaveText(/ETH|Gwei/);
    await recorder.step(popup, 'Solana 模式 fee 显示', {
      note: '5000 lamports / signature → ~0.000005 SOL。不走 ETH gas estimate。',
    });
  } finally {
    await teardownWalletContext(ctx);
  }
});