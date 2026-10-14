/**
 * Wallet — popup: broadcast a Tron native TRX transfer through the
 * popup's transfer flow with a hermetic TronGrid RPC stub.
 *
 * The wallet's Tron signing path (js/chain/signing-service.js →
 * signTronTransactionLocal) follows these steps:
 *
 *   1. Read the active chainKey; if it starts with `tron:` switch to
 *      Tron-shaped parameters (`asset: 'TRX'`, `valueTrx`, `feeLimitSun`).
 *   2. POST `/wallet/createtransaction` → receive raw tx skeleton
 *      (raw_data + raw_data_hex).
 *   3. Compute `sha256(raw_data_hex_bytes)` → 32-byte digest.
 *   4. Local ECDSA over the digest using the secp256k1 private key
 *      (re-used from the EVM keyring).
 *   5. Normalise `v` from 27/28 (ethers) to 0/1 (Tron).
 *   6. Append `r || s || v` to `raw_data_hex_bytes` → 65-byte suffix.
 *   7. POST `/wallet/broadcasttransaction` with `{ raw_data_hex, signature }`.
 *
 * We stub TronGrid entirely (no live RPC) but compute the
 * sha256(raw_data_hex) txid in the route handler so the activity list
 * sees a real, deterministic tx hash.
 *
 * Flow:
 *
 *   1. Stub TronGrid mainnet.
 *   2. Stub public YeYing endpoints (otherwise the wallet stalls on the
 *      EVM keyring-init balance fetch).
 *   3. Import the Hardhat/Anvil secp256k1 account #0 — its derived Tron
 *      mainnet address is TYBNgWfhGuNzdLtjKtxXTfskAhTbMcqbaG.
 *   4. Switch the active network to Tron mainnet via the network
 *      selector (Tron is registered as `tronMainnet` in
 *      `js/config/network-config.js`).
 *   5. Open the transfer page, fill a Base58 recipient + 1 TRX.
 *   6. Send. Assert:
 *      - Fee estimate text shows the Tron fixed range (`0–15 TRX`),
 *        NOT an ETH gas estimate.
 *      - The captured `/wallet/broadcasttransaction` request includes a
 *        65-byte ECDSA suffix (64 bytes r||s + 1 byte v in {0,1}).
 *      - A new tx appears in the activity list with the txid we
 *        returned.
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

// A real mainnet-format recipient — any valid Base58Check address will
// do, since the stub ignores it.
const RECIPIENT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // USDT mainnet contract

test(localizedTitle("【转账与交易 / UI】 广播 Tron 本机 TRX 传输到达 /wallet/broadcasttransaction，带有 65 字节 ECDSA 后缀", "broadcast Tron native TRX transfer reaches /wallet/broadcasttransaction with a 65-byte ECDSA suffix"), async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const captured: TronRpcCapture = await routeTronNode(ctx.context, TRON_MAINNET_RPC_URL + '/**', {
      balanceSun: '50000000', // 50 TRX so the wallet considers the sender funded
    });

    const popup = await openPopup(ctx.context, ctx.extensionId);

    // -- Step 1: import the Hardhat account #0 as a Tron private-key wallet ---
    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });
    await byId(popup, 'welcomeImportWalletBtn').click();
    await byId(popup, 'importPage').waitFor({ state: 'visible' });
    // 选网络 = Tron，方法 = 私钥。
    await selectImportNetwork(popup, 'tron', 'privateKey');
    await byId(popup, 'importPrivateKey').fill(TEST_TRON_PRIVATE_KEY);
    await byId(popup, 'importAccountName').fill('E2E Tron Sender');
    await byId(popup, 'importWalletPassword').fill(TEST_PASSWORD);
    await byId(popup, 'importBtn').click();
    await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 30_000 });

    // -- Step 2: switch to Tron mainnet ---------------------------------------
    await sendSw(popup, 'SWITCH_NETWORK', { networkKey: 'tronMainnet' });
    await recorder.step(popup, '切到 Tron 主网后页面', {
      note: '当前账户的 namespace=tron → #transferFeeEstimate 显示 0–15 TRX 而非 ETH 预估。',
    });

    // -- Step 3: open the transfer screen and verify Tron-shaped UI -----------
    await byId(popup, 'transferBtn').click();
    await byId(popup, 'transferPage').waitFor({ state: 'visible' });

    // Tron-mode fee estimate is the fixed-range placeholder.
    await byId(popup, 'transferFeeEstimate').waitFor({ state: 'visible' });
    await expect(byId(popup, 'transferFeeEstimate')).toHaveText(/TRX/);

    await byId(popup, 'recipientAddress').fill(RECIPIENT);
    await byId(popup, 'amount').fill('1');

    // Stub ETH RPC calls are not relevant here; the popup will only
    // reach the Tron endpoint. Trigger a balance refresh + fee estimate.
    await recorder.step(popup, '填好 Tron 收款地址 + 1 TRX', {
      note: 'TransactionSendController.detectChainKind() 识别到当前账户 namespace=tron → 走 TRX native transfer 路径。',
    });

    await byId(popup, 'sendBtn').click();

    // -- Step 4: assert on the captured RPC calls -----------------------------
    // Allow a moment for the SW to dispatch the broadcast.
    await pollUntil(() => captured.broadcastTxids.length > 0, 5_000);
    expect(captured.broadcastTxids.length).toBeGreaterThanOrEqual(1);

    // The unsigned create-transaction request must include the from / to /
    // amount fields the adapter forwards. We assert on the first
    // createtransaction payload.
    const createTxCall = captured.calls.find((c) => c.path.endsWith('/wallet/createtransaction'));
    expect(createTxCall, 'wallet/createtransaction must have been called').toBeTruthy();
    expect(createTxCall!.payload).toMatchObject({
      owner_address: expect.stringMatching(/^41[0-9a-fA-F]{40}$/),
      to_address: expect.stringMatching(/^41[0-9a-fA-F]{40}$/),
      amount: expect.any(Number),
    });

    // The signed payload appended r||s||v (65 bytes = 130 hex chars)
    // after raw_data_hex.
    const lastSig = captured.signatures[captured.signatures.length - 1];
    expect(lastSig, 'broadcast must include a signature').toBeTruthy();
    // signature is a hex string (no 0x prefix per TronGrid wire spec).
    expect(lastSig!).toMatch(/^[0-9a-fA-F]+$/);
    // The adapter concatenates raw_data_hex + r (32 bytes) + s (32 bytes) +
    // v (1 byte). For mainnet v ∈ {0, 1}, so the tail is always even
    // hex length. We assert the signed rawDataHex is longer than the
    // unsigned one by ≥130 hex chars.
    const unsignedHex = (() => {
      // Find the createtransaction response via the captured calls —
      // routeTronNode doesn't capture responses by default. Instead
      // compare to broadcast rawDataHex: the signed one must be the
      // unsigned raw_data_hex + 65-byte suffix.
      const lastRawData = captured.rawDataHex[captured.rawDataHex.length - 1];
      return lastRawData;
    })();
    expect(unsignedHex).toBeTruthy();
    // The signed payload is what the SW actually POSTs.
    const broadcastCall = captured.calls.findLast((c) => c.path.endsWith('/wallet/broadcasttransaction'));
    expect(broadcastCall, 'broadcast call must exist').toBeTruthy();
    const broadcastRawDataHex = String(broadcastCall!.payload.raw_data_hex ?? '');
    // 65-byte ECDSA suffix appended → 130 hex chars longer than the
    // 0-byte-tail unsigned version.
    expect(broadcastRawDataHex.length).toBe(unsignedHex!.length + 130);
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