/**
 * Wallet — popup: transfer a TRC20 token (USDT) on Tron mainnet through
 * the popup transfer flow with a hermetic TronGrid REST stub.
 *
 * The wallet surfaces the builtin `tron:mainnet` USDT contract from
 * `BUILTIN_TOKENS_BY_CHAIN_KEY`, reads its balance via
 * `/wallet/triggerconstantcontract` (balanceOf), and — when the user
 * selects it and sends — routes through `buildTrc20Unsigned`
 * (`/wallet/triggersmartcontract` transfer(address,uint256)) rather than
 * the native TRX `/wallet/createtransaction` path.
 *
 * We assert:
 *   1. The USDT option appears in the transfer token selector (keyed by contract).
 *   2. `/wallet/triggersmartcontract` is reached, then `/wallet/broadcasttransaction`.
 *   3. The recorded transaction's value is denominated in USDT (proving the
 *      TRC20 token path ran, not native TRX).
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, openPopup, sendSw, selectImportNetwork } from '../helpers/popup';
import { routeTronNode, TRON_MAINNET_RPC_URL, type TronRpcCapture } from '../helpers/tron-rpc';

const TEST_TRON_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_PASSWORD = 'E2E-password-2026';

// Builtin TRC20 USDT contract (js/config/network-config.js BUILTIN_TOKENS_BY_CHAIN_KEY).
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const RECIPIENT = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8';

test(localizedTitle("【转账与交易 / UI】 通过智能合约路径在 Tron 路由上传输 TRC20 USDT，而不是本机 TRX", "transfer TRC20 USDT on Tron routes through the smart-contract path, not native TRX"), async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const captured: TronRpcCapture = await routeTronNode(ctx.context, TRON_MAINNET_RPC_URL + '/**', {
      balanceSun: '100000000', // 100 TRX for fees
      trc20Balance: '100000000', // 100 USDT (6 decimals)
    });

    const popup = await openPopup(ctx.context, ctx.extensionId);

    // -- Import + switch to Tron mainnet --------------------------------------
    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });
    await byId(popup, 'welcomeImportWalletBtn').click();
    await byId(popup, 'importPage').waitFor({ state: 'visible' });
    await selectImportNetwork(popup, 'tron', 'privateKey');
    await byId(popup, 'importPrivateKey').fill(TEST_TRON_PRIVATE_KEY);
    await byId(popup, 'importAccountName').fill('E2E TRC20 Sender');
    await byId(popup, 'importWalletPassword').fill(TEST_PASSWORD);
    await byId(popup, 'importBtn').click();
    await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 30_000 });

    await sendSw(popup, 'SWITCH_NETWORK', { networkKey: 'tronMainnet' });

    // -- Open transfer and select the builtin USDT (TRC20) token --------------
    await byId(popup, 'transferBtn').click();
    await byId(popup, 'transferPage').waitFor({ state: 'visible' });

    const tokenSelector = popup.locator('.token-selector');
    await tokenSelector.locator('.token-trigger').click();
    const option = tokenSelector.locator(`.token-option[data-value="${USDT_CONTRACT}"]`);
    await option.waitFor({ state: 'visible', timeout: 10_000 });
    await option.click();
    await expect(byId(popup, 'transferTokenSymbol')).toContainText('USDT');
    await recorder.step(popup, '选择 TRC20 USDT 进行转账', {
      note: 'BUILTIN_TOKENS_BY_CHAIN_KEY[tron:mainnet] 提供 USDT 合约；余额经 triggerconstantcontract balanceOf。',
    });

    await byId(popup, 'recipientAddress').fill(RECIPIENT);
    await byId(popup, 'amount').fill('10');
    await byId(popup, 'sendBtn').click();

    // -- Assert smart-contract build + broadcast reached ----------------------
    await pollUntil(() => captured.broadcastTxids.length > 0, 10_000);
    expect(captured.broadcastTxids.length).toBeGreaterThanOrEqual(1);

    const triggerCall = captured.calls.findLast((c) => /\/wallet\/triggersmartcontract$/.test(c.path));
    expect(triggerCall, '/wallet/triggersmartcontract must have been called for a TRC20 transfer').toBeTruthy();
    const broadcastCall = captured.calls.findLast((c) => /\/wallet\/broadcasttransaction$/.test(c.path));
    expect(broadcastCall, '/wallet/broadcasttransaction must have been called').toBeTruthy();

    // The recorded tx value must be denominated in USDT, proving the TRC20 token
    // path ran (native TRX would record "<n> TRX").
    const txResp = await sendSw<{ success?: boolean; transactions?: Array<{ value?: string; token?: { symbol?: string } }> }>(
      popup,
      'GET_TRANSACTIONS',
      { address: '' },
    );
    const txs = txResp?.transactions ?? [];
    const usdtTx = txs.find((t) => /USDT/.test(String(t?.value ?? '')) || t?.token?.symbol === 'USDT');
    expect(usdtTx, `expected a USDT-denominated tx record, got ${JSON.stringify(txs)}`).toBeTruthy();
    await recorder.step(popup, 'TRC20 USDT transfer 已广播并记录', {
      note: '交易记录 value = "10 USDT"，证明走 triggersmartcontract transfer(address,uint256) 路径而非 native TRX。',
    });
  } finally {
    await teardownWalletContext(ctx);
  }
});

async function pollUntil(predicate: () => boolean, timeoutMs: number, intervalMs = 100): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
