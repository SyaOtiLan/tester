/**
 * Wallet — popup: import a Solana private key and assert the derived
 * account address matches the deterministic Anvil/Hardhat secp256k1
 * account #0 (reused as ed25519 seed per v1 simplification).
 *
 * Mirrors `popup-import-tron-privatekey.spec.ts` but exercises the
 * Solana-specific tab:
 *
 *   `.import-tab.import-method-tab[data-type="privateKey"][data-chain="solana"]`
 *
 * Vector: the well-known Hardhat/Anvil secp256k1 account #0 private
 * key. With wallet v1 simplification the same 32 bytes are the ed25519
 * seed, deriving:
 *
 *   0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
 *     → 5kMDkdera2vkpd3XkjMd851WJ4EnE9nxGcukW2mW7AU3 (base58(32B ed25519 pubkey))
 *
 * We assert on the truncated prefix/suffix in the popup (resilient to
 * the unicode-ellipsis switch in the popup renderer) and the full
 * address through the SW message bus.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, openPopup, selectImportNetwork } from '../helpers/popup';
import { sendSw } from '../helpers/popup';

// Hardhat/Anvil account #0 — same vector used by the unit suite
// `tests/address-normalize.test.mjs` (v1: secp256k1 sk bytes reused as ed25519 seed).
const TEST_SOLANA_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const EXPECTED_SOLANA_ADDRESS = '5kMDkdera2vkpd3XkjMd851WJ4EnE9nxGcukW2mW7AU3';
const TEST_PASSWORD = 'E2E-password-2026';

test(localizedTitle("【钱包导入 / UI】 import Solana 私钥以预期的 base58 地址登陆 #walletPage", "import Solana private key lands on #walletPage with the expected base58 address"), async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await openPopup(ctx.context, ctx.extensionId);

    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });
    await byId(popup, 'welcomeImportWalletBtn').click();
    await byId(popup, 'importPage').waitFor({ state: 'visible' });
    await recorder.step(popup, '导入页', {
      note: '统一 UI：网络下拉 + 助记词/私钥 switch；选 Solana 即出现 mainnet/devnet/testnet。',
    });

    // 选网络 = Solana，方法 = 私钥。
    await selectImportNetwork(popup, 'solana', 'privateKey');
    await expect(byId(popup, 'importReferenceGroup')).toBeVisible();
    await expect(byId(popup, 'privateKeyImportSection')).toBeVisible();

    await byId(popup, 'importPrivateKey').fill(TEST_SOLANA_PRIVATE_KEY);
    await byId(popup, 'importAccountName').fill('E2E Solana PK');
    await byId(popup, 'importWalletPassword').fill(TEST_PASSWORD);
    await recorder.step(popup, '填好 Solana 私钥、账户名、密码', {
      note: 'Solana 私钥格式与 EVM/Tron 相同（32 字节 hex，带 0x 前缀）；v1 简化：当作 ed25519 seed。',
    });
    await byId(popup, 'importBtn').click();

    await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 30_000 });
    await recorder.step(popup, '导入完成，回到主页', {
      note: '地址 = privateKeyToSolanaAddress(priv) 的 base58(32B ed25519 pubkey) 编码。',
    });

    const displayedAddress = (await byId(popup, 'accountAddress').textContent())?.trim() ?? '';
    // Popup truncates the address with a unicode/ASCII ellipsis into
    // "<head>…<tail>". Assert on shape (base58 alphabet + truncation marker)
    // and that head/tail are a genuine prefix/suffix of the known full
    // address (the exact head/tail lengths are a popup rendering detail).
    // The full address is cross-checked via the SW message bus below.
    expect(displayedAddress).toMatch(/…|\.\.\./);
    const [head, tail] = displayedAddress.split(/…|\.\.\./);
    expect(head).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(tail).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(EXPECTED_SOLANA_ADDRESS.startsWith(head)).toBe(true);
    expect(EXPECTED_SOLANA_ADDRESS.endsWith(tail)).toBe(true);

    // Cross-check the *full* address through the SW message bus so the
    // truncation marker doesn't fool us. handleGetCurrentAccount wraps the
    // account under a `.account` key alongside `{ success: true }`.
    const response = await sendSw<{ success?: boolean; account?: { address: string; namespace: string; chainKey: string } }>(
      popup,
      'GET_CURRENT_ACCOUNT',
    );
    const currentAccount = response?.account;
    expect(currentAccount?.namespace).toBe('solana');
    expect(currentAccount?.chainKey).toBe('solana:mainnet-beta');
    expect(currentAccount?.address).toBe(EXPECTED_SOLANA_ADDRESS);
  } finally {
    await teardownWalletContext(ctx);
  }
});