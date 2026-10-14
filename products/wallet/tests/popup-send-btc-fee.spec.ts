/**
 * Wallet — popup: Bitcoin-mode fee estimate shows sat/vB units sourced
 * from the Esplora `/fee-estimates` endpoint, not ETH gas.
 *
 * When the active account is bip122, `TransactionSendController.updateFeeEstimate`
 * skips the EVM gas path entirely and instead calls
 * `TransactionDomain.getBitcoinFeeRate` → SW `GET_BITCOIN_FEE_RATE` →
 * `bip122/rpc.js#getFeeRate`, which reads Esplora `/fee-estimates` and
 * picks the 6-block target (falling back to 3 / 1, then 10 sat/vB).
 *
 * We stub `/fee-estimates` with { '1': 20, '3': 12, '6': 8 } so the
 * displayed rate must resolve to the 6-block target — "~8 sat/vB".
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, openPopup, sendSw, selectImportNetwork } from '../helpers/popup';
import { routeBitcoinNode, BITCOIN_MAINNET_RPC_URL, type BitcoinRpcCapture } from '../helpers/bitcoin-rpc';

const TEST_BITCOIN_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_PASSWORD = 'E2E-password-2026';

test(localizedTitle("【转账与交易 / UI】 Bitcoin-模式费用估算显示来自 Esplora 费用估算的 sat/vB 单位", "Bitcoin-mode fee estimate shows sat/vB units from Esplora fee-estimates"), async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const captured: BitcoinRpcCapture = await routeBitcoinNode(ctx.context, BITCOIN_MAINNET_RPC_URL + '/**', {
      feeEstimates: { '1': 20, '3': 12, '6': 8 },
    });

    const popup = await openPopup(ctx.context, ctx.extensionId);

    // Import + switch to Bitcoin mainnet.
    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });
    await byId(popup, 'welcomeImportWalletBtn').click();
    await byId(popup, 'importPage').waitFor({ state: 'visible' });
    await selectImportNetwork(popup, 'bitcoin', 'privateKey');
    await byId(popup, 'importPrivateKey').fill(TEST_BITCOIN_PRIVATE_KEY);
    await byId(popup, 'importAccountName').fill('E2E Bitcoin Fee');
    await byId(popup, 'importWalletPassword').fill(TEST_PASSWORD);
    await byId(popup, 'importBtn').click();
    await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 30_000 });

    await sendSw(popup, 'SWITCH_NETWORK', { networkKey: 'bitcoinMainnet' });

    await byId(popup, 'transferBtn').click();
    await byId(popup, 'transferPage').waitFor({ state: 'visible' });

    // Fee estimate must be in sat/vB and reflect the 6-block target (8).
    await byId(popup, 'transferFeeEstimate').waitFor({ state: 'visible' });
    await expect(byId(popup, 'transferFeeEstimate')).toHaveText(/sat\/vB/);
    await expect(byId(popup, 'transferFeeEstimate')).not.toHaveText(/ETH|Gwei/);
    await expect(byId(popup, 'transferFeeEstimate')).toHaveText('~8 sat/vB');

    await recorder.step(popup, 'Bitcoin 主网 fee 显示 ~8 sat/vB', {
      note: 'getFeeRate 取 /fee-estimates 的 6 区块目标 = 8 sat/vB；单位是 sat/vB 而非 ETH gas。',
    });

    // The fee-estimates endpoint must actually have been queried.
    const feeCalls = captured.calls.filter((c) => /\/fee-estimates$/.test(c.path));
    expect(feeCalls.length).toBeGreaterThanOrEqual(1);
  } finally {
    await teardownWalletContext(ctx);
  }
});
