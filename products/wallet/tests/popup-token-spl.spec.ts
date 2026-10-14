/**
 * Wallet — popup: transfer an SPL token (USDC) on Solana mainnet through
 * the popup transfer flow with a hermetic Solana JSON-RPC stub.
 *
 * The wallet surfaces the builtin `solana:mainnet-beta` USDC mint from
 * `BUILTIN_TOKENS_BY_CHAIN_KEY`, queries its balance via
 * `getTokenAccountsByOwner`, and — when the user selects it and sends —
 * routes through `buildSplTokenTransfer` (SPL TransferChecked, tag=12)
 * rather than the native SOL path.
 *
 * We assert:
 *   1. The USDC option appears in the transfer token selector (keyed by mint).
 *   2. `sendTransaction` is reached (broadcast wire is base58).
 *   3. The recorded transaction's value is denominated in USDC (proving the
 *      SPL token path ran, not native SOL).
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, openPopup, sendSw, selectImportNetwork } from '../helpers/popup';
import { routeSolanaNode, SOLANA_MAINNET_RPC_URL, type SolanaRpcCapture } from '../helpers/solana-rpc';

const TEST_SOLANA_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_PASSWORD = 'E2E-password-2026';

// Builtin SPL USDC mint (js/config/network-config.js BUILTIN_TOKENS_BY_CHAIN_KEY).
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const RECIPIENT = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

test(localizedTitle("【转账与交易 / API】 通过 SPL 令牌路径在 Solana 路由上传输 SPL USDC，而不是本机 SOL", "transfer SPL USDC on Solana routes through the SPL token path, not native SOL"), async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const captured: SolanaRpcCapture = await routeSolanaNode(ctx.context, SOLANA_MAINNET_RPC_URL + '/**', {
      balanceLamports: '50000000000', // 50 SOL for fees
      splTokenAmount: '100000000', // 100 USDC (6 decimals)
    });

    const popup = await openPopup(ctx.context, ctx.extensionId);

    // -- Import + switch to Solana mainnet ------------------------------------
    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });
    await byId(popup, 'welcomeImportWalletBtn').click();
    await byId(popup, 'importPage').waitFor({ state: 'visible' });
    await selectImportNetwork(popup, 'solana', 'privateKey');
    await byId(popup, 'importPrivateKey').fill(TEST_SOLANA_PRIVATE_KEY);
    await byId(popup, 'importAccountName').fill('E2E SPL Sender');
    await byId(popup, 'importWalletPassword').fill(TEST_PASSWORD);
    await byId(popup, 'importBtn').click();
    await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 30_000 });

    await sendSw(popup, 'SWITCH_NETWORK', { networkKey: 'solanaMainnet' });

    // -- Open transfer and select the builtin USDC (SPL) token ----------------
    await byId(popup, 'transferBtn').click();
    await byId(popup, 'transferPage').waitFor({ state: 'visible' });

    const tokenSelector = popup.locator('.token-selector');
    await tokenSelector.locator('.token-trigger').click();
    const option = tokenSelector.locator(`.token-option[data-value="${USDC_MINT}"]`);
    await option.waitFor({ state: 'visible', timeout: 10_000 });
    await option.click();
    await expect(byId(popup, 'transferTokenSymbol')).toContainText('USDC');
    await recorder.step(popup, '选择 SPL USDC 进行转账', {
      note: 'BUILTIN_TOKENS_BY_CHAIN_KEY[solana:mainnet-beta] 提供 USDC mint；余额经 getTokenAccountsByOwner。',
    });

    await byId(popup, 'recipientAddress').fill(RECIPIENT);
    await byId(popup, 'amount').fill('10');
    await byId(popup, 'sendBtn').click();

    // -- Assert broadcast reached + recorded as a USDC (SPL) transfer ---------
    await pollUntil(() => captured.sentTxs.length > 0, 10_000);
    expect(captured.sentTxs.length).toBeGreaterThanOrEqual(1);

    const sendCall = captured.calls.findLast((c) => c.method === 'sendTransaction');
    expect(sendCall, 'sendTransaction must have been called').toBeTruthy();
    expect(String(sendCall!.params[0] ?? '')).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);

    // The recorded tx value must be denominated in USDC, proving the SPL token
    // path ran (native SOL would record "<n> SOL").
    const txResp = await sendSw<{ success?: boolean; transactions?: Array<{ value?: string; token?: { symbol?: string } }> }>(
      popup,
      'GET_TRANSACTIONS',
      { address: '' },
    );
    const txs = txResp?.transactions ?? [];
    const usdcTx = txs.find((t) => /USDC/.test(String(t?.value ?? '')) || t?.token?.symbol === 'USDC');
    expect(usdcTx, `expected a USDC-denominated tx record, got ${JSON.stringify(txs)}`).toBeTruthy();
    await recorder.step(popup, 'SPL USDC transfer 已广播并记录', {
      note: '交易记录 value = "10 USDC"，证明走 SPL TransferChecked 路径而非 native SOL。',
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
