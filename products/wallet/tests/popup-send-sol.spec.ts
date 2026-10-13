/**
 * Wallet — popup: broadcast a Solana native SOL transfer through the
 * popup's transfer flow with a hermetic Solana JSON-RPC stub.
 *
 * The wallet's Solana signing path
 * (js/chain/signing-service.js → signSolanaTransactionLocal →
 * registry → solanaAdapter.buildUnsigned / assembleSigned / broadcast)
 * follows these steps:
 *
 *   1. Read the active chainKey; if it starts with `solana:` switch to
 *      Solana-shaped parameters (`asset: 'SOL'`, `amountSol`).
 *   2. RPC `getRecentBlockhash` → 32-byte blockhash.
 *   3. Hand-rolled SystemProgram.transfer + Transaction.serializeMessage.
 *   4. Local ed25519 detached sign over the full message bytes.
 *   5. Wire = compact-u16(sig_count) || sigs || message_bytes (base58).
 *   6. RPC `sendTransaction` with `{ encoding: 'base58' }` → returns
 *      base58 transaction signature.
 *
 * We stub Solana mainnet RPC entirely (no live RPC) but record the wire
 * tx into the capture sink so specs can assert on it.
 */
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, openPopup, sendSw, selectImportNetwork } from '../helpers/popup';
import { routeSolanaNode, SOLANA_MAINNET_RPC_URL, type SolanaRpcCapture } from '../helpers/solana-rpc';

const TEST_SOLANA_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_PASSWORD = 'E2E-password-2026';

// A valid base58 Solana address (32-byte ed25519 pubkey). Any decoded
// 32-byte base58 string is acceptable since the stub ignores the field.
const RECIPIENT = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

test("【转账与交易 / UI】 广播 Solana 本机 SOL 传输通过 ed25519 sig 到达 sendTransaction", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const captured: SolanaRpcCapture = await routeSolanaNode(ctx.context, SOLANA_MAINNET_RPC_URL + '/**', {
      balanceLamports: '50000000000', // 50 SOL so the wallet considers the sender funded
    });

    const popup = await openPopup(ctx.context, ctx.extensionId);

    // -- Step 1: import the Hardhat account #0 as a Solana private-key wallet --
    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });
    await byId(popup, 'welcomeImportWalletBtn').click();
    await byId(popup, 'importPage').waitFor({ state: 'visible' });
    await selectImportNetwork(popup, 'solana', 'privateKey');
    await byId(popup, 'importPrivateKey').fill(TEST_SOLANA_PRIVATE_KEY);
    await byId(popup, 'importAccountName').fill('E2E Solana Sender');
    await byId(popup, 'importWalletPassword').fill(TEST_PASSWORD);
    await byId(popup, 'importBtn').click();
    await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 30_000 });

    // -- Step 2: switch to Solana mainnet -------------------------------------
    await sendSw(popup, 'SWITCH_NETWORK', { networkKey: 'solanaMainnet' });
    await recorder.step(popup, '切到 Solana 主网后页面', {
      note: '当前账户的 namespace=solana → #transferFeeEstimate 显示 ~0.000005 SOL 而非 ETH 预估。',
    });

    // -- Step 3: open the transfer screen and verify Solana-shaped UI --------
    await byId(popup, 'transferBtn').click();
    await byId(popup, 'transferPage').waitFor({ state: 'visible' });

    // Solana-mode fee estimate is the fixed-base placeholder.
    await byId(popup, 'transferFeeEstimate').waitFor({ state: 'visible' });
    await expect(byId(popup, 'transferFeeEstimate')).toHaveText(/SOL/);

    await byId(popup, 'recipientAddress').fill(RECIPIENT);
    await byId(popup, 'amount').fill('0.1');

    await recorder.step(popup, '填好 Solana 收款地址 + 0.1 SOL', {
      note: 'TransactionSendController.detectChainKind() 识别到当前账户 namespace=solana → 走 SOL native transfer 路径。',
    });

    await byId(popup, 'sendBtn').click();

    // -- Step 4: assert on the captured RPC calls -----------------------------
    // Allow a moment for the SW to dispatch the broadcast.
    await pollUntil(() => captured.sentTxs.length > 0, 10_000);
    expect(captured.sentTxs.length).toBeGreaterThanOrEqual(1);

    // The wallet must have queried getRecentBlockhash at least once
    // (we don't care how many times — once before sign).
    const blockhashCalls = captured.calls.filter((c) => c.method === 'getRecentBlockhash');
    expect(blockhashCalls.length).toBeGreaterThanOrEqual(1);

    // The sendTransaction request must carry the base58 wire tx as the
    // first positional argument with encoding 'base58'.
    const sendCall = captured.calls.findLast((c) => c.method === 'sendTransaction');
    expect(sendCall, 'sendTransaction must have been called').toBeTruthy();
    const wire = String(sendCall!.params[0] ?? '');
    expect(wire).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    const opts = (sendCall!.params[1] ?? {}) as { encoding?: string };
    expect(opts.encoding).toBe('base58');
  } finally {
    await teardownWalletContext(ctx);
  }
});

/**
 * Poll a predicate until it returns truthy or the deadline elapses.
 * Avoids pulling in a separate waiter library.
 */
async function pollUntil(predicate: () => boolean, timeoutMs: number, intervalMs = 100): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}