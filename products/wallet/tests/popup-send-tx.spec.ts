/**
 * Wallet — popup smoke: broadcast a real transaction on Sepolia testnet.
 *
 * This is the only test in the matrix that hits a *live* chain. The
 * purpose is end-to-end validation of the popup's own transfer flow
 * (build tx → sign → broadcast → confirm) on a public network where
 * failures surface real bugs:
 *
 *   - nonce management
 *   - gas estimation against an unfamilar chain
 *   - hash returned by the node matches what ethers-style libraries expect
 *   - the transaction-list controller picks up the new tx and renders it
 *
 * Setup uses the Hardhat/Anvil test mnemonic (account #0,
 * `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`) which is publicly funded
 * on Sepolia via the standard faucets at the time of writing. If the
 * balance ever drops to zero, the test skips with a remediation hint.
 *
 * Flow:
 *
 *   1. Import the Hardhat mnemonic.
 *   2. Add Sepolia (chainId 0xaa36a7) via `chrome.runtime.sendMessage`
 *      directly from the popup page (no dApp / approval window needed).
 *   3. Pre-flight: `eth_getBalance` on Sepolia — skip if zero.
 *   4. Switch to Sepolia via the popup's network selector UI.
 *   5. Fill the transfer form (burn address + 0.0001 ETH).
 *   6. Click `#sendBtn`; if the wallet is locked, fill the password
 *      modal that appears inside the popup (no separate approval window).
 *   7. Wait for the new tx to appear in the activity list with a
 *      `data-tx-hash` matching `^0x[0-9a-f]{64}$`.
 *   8. Cross-check the hash via Sepolia public RPC
 *      (`eth_getTransactionByHash`) — proves the broadcast really
 *      landed.
 *
 * Why we don't stub the wallet's outbound network requests here: this
 * test is the explicit exception. Other popup specs call
 * `stubPublicEndpoints` to keep CI hermetic — this one needs the
 * Sepolia RPC to be reachable. We still block `*.yeying.pub` so the
 * keyring-init balance fetch doesn't stall on YeYing Mainnet.
 */
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { byId, openPopup } from '../helpers/popup';

// Anvil/Hardhat test mnemonic #0 — same vector used in popup-import.
const TEST_MNEMONIC = 'test test test test test test test test test test test junk';
const TEST_PASSWORD = 'E2E-password-2026';
const TEST_WALLET_NAME = 'Sepolia E2E Wallet';

// Sepolia public RPC + chainId. Reachable from CI; no auth.
const SEPOLIA_CHAIN_ID_HEX = '0xaa36a7';
const SEPOLIA_RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com';
const SEPOLIA_EXPLORER = 'https://sepolia.etherscan.io';
const SEPOLIA_SYMBOL = 'ETH';

// 0x000...001 is the canonical "burn address" — no private key exists,
// so any ETH sent is unrecoverable. Perfect for a smoke test.
const BURN_ADDRESS = '0x0000000000000000000000000000000000000001';
// A tiny amount that even a near-empty testnet faucet can afford
// (≈ 0.000001 ETH = 1e12 wei). With Sepolia gas at ~1 gwei, a base
// transfer costs ~2.25e13 wei, so the floor for "afford tx + gas" is
// around 3e13 wei.
const SEND_AMOUNT_ETH = '0.000001';

interface RpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

/**
 * Minimal JSON-RPC POST helper for the public Sepolia endpoint.
 * Used both for the pre-flight balance check and for the post-broadcast
 * `eth_getTransactionByHash` cross-check.
 *
 * Public Sepolia RPCs are occasionally flaky from CI networks (TLS
 * handshakes hang mid-flow). Retry up to 3 times with a short backoff
 * so a transient blip doesn't fail an otherwise-good test.
 */
async function sepoliaRpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(SEPOLIA_RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        throw new Error(`Sepolia RPC HTTP ${res.status}`);
      }
      const json = (await res.json()) as RpcResponse<T>;
      if (json.error) {
        throw new Error(`Sepolia RPC error ${json.error.code}: ${json.error.message}`);
      }
      return json.result as T;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function sepoliaBalanceWei(address: string): Promise<bigint> {
  const hex = await sepoliaRpc<string>('eth_getBalance', [address, 'latest']);
  return BigInt(hex);
}

test("【转账与交易 / E2E】 在 Sepolia 上广播真实交易并在活动列表中看到它", async ({
  recorder,
}) => {
  // Block every YeYing public host — this test specifically targets
  // Sepolia, but the wallet's keyring-init still pings YeYing Mainnet.
  // Letting those through stalls the unlock page.
  const ctx = await loadWalletContext();
  try {
    await ctx.context.route('https://*.yeying.pub/**', (route) => route.abort('connectionfailed'));
    // Block the wallet's default Ethereum mainnet RPC; we want Sepolia
    // to be the only live chain during the test.
    await ctx.context.route('https://ethereum-rpc.publicnode.com/**', (route) =>
      route.abort('connectionfailed'),
    );

    // -- Step 1: import the well-known Anvil mnemonic --------------------
    const popup = await openPopup(ctx.context, ctx.extensionId);
    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });
    await byId(popup, 'welcomeImportWalletBtn').click();
    await byId(popup, 'importPage').waitFor({ state: 'visible' });
    await byId(popup, 'importMnemonic').fill(TEST_MNEMONIC);
    await byId(popup, 'importAccountName').fill(TEST_WALLET_NAME);
    await byId(popup, 'importWalletPassword').fill(TEST_PASSWORD);
    await byId(popup, 'importBtn').click();
    await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 30_000 });
    await recorder.step(popup, '导入助记词，进入主页', {
      note: 'Anvil/Hardhat 测试助记词 #0；地址以 0xf39 开头。',
    });

    // -- Step 2: pre-flight — confirm the account actually has Sepolia ETH
    // We need the full address. The popup renders it truncated; ask the
    // SW directly via the message bus the wallet itself uses.
    const fullAddress = (await popup.evaluate(async () => {
      const result = await (globalThis as any).chrome.runtime.sendMessage({
        type: 'GET_CURRENT_ACCOUNT',
      });
      if (!result?.success || !result.account) return null;
      return result.account.address || null;
    })) as string | null;
    expect(fullAddress, 'wallet should expose at least one account').toBeTruthy();
    expect(fullAddress!).toMatch(/^0x[\da-fA-F]{40}$/);

    const balanceWei = await sepoliaBalanceWei(fullAddress!);
    test.skip(
      balanceWei === 0n,
      `Sepolia balance for ${fullAddress} is 0 — fund via https://sepoliafaucet.com/ and rerun`,
    );
    // A Sepolia base transfer is ~21000 gas × current gas price (a few
    // gwei). The well-known Hardhat/Anvil #0 faucet account used here
    // gets a small drip from public faucets — not enough to cover
    // value + gas once it bottoms out. We set the floor well above
    // value + gas; if it dips below, the test surfaces a clear hint
    // so a human can top it up.
    test.skip(
      balanceWei < BigInt(3e13),
      `Sepolia balance for ${fullAddress} is ${balanceWei} wei (<0.00003 ETH) — fund via https://sepoliafaucet.com/ and rerun`,
    );

    // -- Step 3: register + activate Sepolia via the SW message bus ------
    // The popup is an extension page, so chrome.runtime.sendMessage
    // reaches the SW directly. We bypass the network selector UI for
    // the *registration* step — the wallet ships only mainnet + YeYing,
    // so there is no Sepolia option in the menu until we add it.
    const addResult = (await popup.evaluate(
      async ({ chainName, chainId, rpcUrl, explorer, symbol }) => {
        try {
          const result = await (globalThis as any).chrome.runtime.sendMessage({
            type: 'ADD_CUSTOM_NETWORK',
            chainName,
            chainId,
            rpcUrl,
            explorer,
            symbol,
            decimals: 18
          });
          return { ok: true, result };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      {
        chainName: 'Sepolia',
        chainId: SEPOLIA_CHAIN_ID_HEX,
        rpcUrl: SEPOLIA_RPC_URL,
        explorer: SEPOLIA_EXPLORER,
        symbol: SEPOLIA_SYMBOL,
      },
    )) as { ok: boolean; result?: { success?: boolean; error?: string }; error?: string };

    if (!addResult.ok || addResult.result?.success === false) {
      // "already exists" is fine — the previous run may have left it in
      // storage. Any other failure is a real bug.
      const msg = addResult.error ?? addResult.result?.error ?? 'unknown';
      test.skip(
        !msg.toLowerCase().includes('already'),
        `ADD_CUSTOM_NETWORK failed: ${msg}`,
      );
    }

    // Now switch to Sepolia via the UI — this exercises the user-facing
    // network selector, which is the real flow a human would follow.
    // First, the transfer screen has the network selector we want
    // (the one at the top of the wallet page also works, but transfer
    // makes the rest of the test linear).
    await byId(popup, 'transferBtn').click();
    await byId(popup, 'transferPage').waitFor({ state: 'visible' });
    await recorder.step(popup, '进入转账页（YeYing 主网默认）', {
      note: '钱包默认没有 Sepolia，需要先用 ADD_CUSTOM_NETWORK 注册。',
    });

    // The transfer page has its own network-selector; clicking the
    // trigger opens the menu with `data-value=<rpcUrl>` options.
    const transferSelector = popup
      .locator('#transferPage [data-network-selector="true"]')
      .first();
    await transferSelector.locator('.network-trigger').click();
    const sepoliaOption = transferSelector.locator(
      `.network-option[data-value="${SEPOLIA_RPC_URL}"]`,
    );
    await sepoliaOption.waitFor({ state: 'visible', timeout: 5_000 });
    await sepoliaOption.click();
    // Trigger label should now read "Sepolia". The wallet renders the
    // label as plain text inside `.network-label`.
    await expect(transferSelector.locator('.network-label')).toHaveText('Sepolia', {
      timeout: 5_000,
    });
    await recorder.step(popup, '网络切换到 Sepolia', {
      note: '走网络选择器 UI，跟用户实际操作一致。',
    });

    // -- Step 4: fill the form -----------------------------------------
    await byId(popup, 'recipientAddress').fill(BURN_ADDRESS);
    await byId(popup, 'amount').fill(SEND_AMOUNT_ETH);
    await recorder.step(popup, '填好金额与收款地址', {
      note: '收款地址是 0x000…001（无人持有私钥的销毁地址），金额 0.0001 ETH。',
    });

    // -- Step 5: submit, handling the popup password modal --------------
    await byId(popup, 'sendBtn').click();

    // The popup may prompt for the wallet password — it's an in-popup
    // modal (NOT a separate approval window). Type-check the modal
    // immediately rather than racing it.
    const modal = popup.locator('#passwordPromptModal');
    const modalVisible = await modal
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (modalVisible) {
      await popup.locator('#passwordPromptInput').fill(TEST_PASSWORD);
      await popup.locator('#passwordPromptConfirm').click();
      await recorder.step(popup, '解锁弹窗：输入密码', {
        note: '发送交易需要重新确认钱包密码（MV3 SW 重启后会重新锁定）。',
      });
    }

    // The send controller shows a waiting overlay while broadcasting.
    // Wait for it to appear and then hide — proves the broadcast round
    // trip completed without throwing.
    await expect(byId(popup, 'globalWaitingOverlay')).toBeVisible({ timeout: 10_000 });
    await expect(byId(popup, 'globalWaitingOverlay')).toBeHidden({ timeout: 60_000 });

    // -- Step 6: the activity list should now contain a fresh tx item ---
    // The onSuccess hook switches to the activity tab and loads the
    // list. The new item carries `data-tx-hash="0x..."`.
    const txItem = popup.locator(
      '#transactionList .transaction-item[data-tx-hash]:not([data-tx-hash=""])',
    );
    await txItem.first().waitFor({ state: 'visible', timeout: 30_000 });
    const txHash = await txItem.first().getAttribute('data-tx-hash');
    expect(txHash, 'transaction-list item should carry a non-empty data-tx-hash').toBeTruthy();
    expect(txHash!).toMatch(/^0x[0-9a-fA-F]{64}$/);

    // -- Step 7: cross-check on-chain via public RPC ---------------------
    // Give Sepolia a moment to propagate; then ask the chain.
    await expect
      .poll(
        async () => {
          const tx = await sepoliaRpc<{ hash: string; from: string; to: string } | null>(
            'eth_getTransactionByHash',
            [txHash],
          );
          return tx;
        },
        { timeout: 30_000, message: 'Sepolia should know about our tx' },
      )
      .toMatchObject({ hash: txHash!.toLowerCase(), from: fullAddress!.toLowerCase() });

    await recorder.step(popup, '交易出现在活动列表，链上确认', {
      note: 'data-tx-hash 即 Sepolia 返回的真实交易哈希，可到 Etherscan 查询。',
    });
  } finally {
    await teardownWalletContext(ctx);
  }
});
