/**
 * Wallet — popup: broadcast a Bitcoin native BTC transfer through the
 * popup's transfer flow with a hermetic Esplora REST stub.
 *
 * The wallet's Bitcoin signing path
 * (js/chain/signing-service.js → signBitcoinTransactionLocal →
 * registry → bitcoinAdapter.buildUnsigned / assembleSigned / broadcast)
 * follows these steps:
 *
 *   1. Read the active chainKey; if it starts with `bip122:` switch to
 *      Bitcoin-shaped parameters (`asset: 'BTC'`, satoshi = BTC × 1e8).
 *   2. REST `GET /address/{from}/utxo` → UTXO 列表; greedy 选币.
 *   3. Per-input BIP-143 sighash → local secp256k1 sign (SIGHASH_ALL).
 *   4. Assemble segwit raw tx (marker/flag 0x0001 + witness).
 *   5. REST `POST /tx` with the raw hex body → returns txid text.
 *
 * We stub blockstream.info entirely (no live RPC) but record the raw tx
 * into the capture sink so specs can assert on the segwit wire format.
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

// A valid mainnet P2WPKH recipient (BIP-173 example vector).
const RECIPIENT = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

test(localizedTitle("【转账与交易 / API】 广播 Bitcoin 本机 BTC 传输通过 segwit 原始交易到达 POST /tx", "broadcast Bitcoin native BTC transfer reaches POST /tx with a segwit raw tx"), async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const captured: BitcoinRpcCapture = await routeBitcoinNode(ctx.context, BITCOIN_MAINNET_RPC_URL + '/**');

    const popup = await openPopup(ctx.context, ctx.extensionId);

    // -- Step 1: import the Hardhat account #0 as a Bitcoin private-key wallet --
    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });
    await byId(popup, 'welcomeImportWalletBtn').click();
    await byId(popup, 'importPage').waitFor({ state: 'visible' });
    await selectImportNetwork(popup, 'bitcoin', 'privateKey');
    await byId(popup, 'importPrivateKey').fill(TEST_BITCOIN_PRIVATE_KEY);
    await byId(popup, 'importAccountName').fill('E2E Bitcoin Sender');
    await byId(popup, 'importWalletPassword').fill(TEST_PASSWORD);
    await byId(popup, 'importBtn').click();
    await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 30_000 });

    // -- Step 2: switch to Bitcoin mainnet ------------------------------------
    await sendSw(popup, 'SWITCH_NETWORK', { networkKey: 'bitcoinMainnet' });
    await recorder.step(popup, '切到 Bitcoin 主网后页面', {
      note: '当前账户 namespace=bip122 → #transferFeeEstimate 显示 sat/vB 而非 ETH 预估。',
    });

    // -- Step 3: open the transfer screen and verify Bitcoin-shaped UI --------
    await byId(popup, 'transferBtn').click();
    await byId(popup, 'transferPage').waitFor({ state: 'visible' });

    await byId(popup, 'transferFeeEstimate').waitFor({ state: 'visible' });
    await expect(byId(popup, 'transferFeeEstimate')).toHaveText(/sat\/vB/);

    await byId(popup, 'recipientAddress').fill(RECIPIENT);
    await byId(popup, 'amount').fill('0.001');

    await recorder.step(popup, '填好 Bitcoin 收款地址 + 0.001 BTC', {
      note: 'detectChainKind() 识别 namespace=bip122 → 走 BTC native transfer；satoshi = 0.001 × 1e8 = 100000。',
    });

    await byId(popup, 'sendBtn').click();

    // -- Step 4: assert on the captured REST calls ----------------------------
    await pollUntil(() => captured.sentTxs.length > 0, 10_000);
    expect(captured.sentTxs.length).toBeGreaterThanOrEqual(1);

    // The wallet must have queried the sender's UTXO set before selecting coins.
    const utxoCalls = captured.calls.filter((c) => /\/utxo$/.test(c.path));
    expect(utxoCalls.length).toBeGreaterThanOrEqual(1);

    // The broadcast body must be a segwit-serialised tx: version 2 (LE) +
    // marker/flag 0x00 0x01 = "020000000001..." hex prefix.
    const rawHex = captured.sentTxs[captured.sentTxs.length - 1];
    expect(rawHex).toMatch(/^[0-9a-fA-F]+$/);
    expect(rawHex.startsWith('020000000001')).toBe(true);
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
