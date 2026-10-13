/**
 * Wallet — popup: import a Tron private key and assert the derived
 * account address matches the deterministic Anvil/Hardhat secp256k1
 * account #0.
 *
 * Mirrors `popup-import-privatekey.spec.ts` (EVM path) but exercises
 * the Tron-specific tab added to `#importPage`:
 *
 *   `.import-tab.import-method-tab[data-type="privateKey"][data-chain="tron"]`
 *
 * Vector: the well-known Hardhat/Anvil secp256k1 account #0 private
 * key. With mainnet prefix 0x41 the address is
 *
 *   0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
 *     → TYBNgWfhGuNzdLtjKtxXTfskAhTbMcqbaG
 *
 * We assert on the truncated prefix/suffix in the popup (resilient to
 * the unicode-ellipsis switch in the popup renderer) and the full
 * address through the SW message bus.
 */
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, openPopup, selectImportNetwork } from '../helpers/popup';
import { sendSw } from '../helpers/popup';

// Hardhat/Anvil account #0 — same vector the unit suite in
// `wallet/tests/tron-vault.test.mjs` uses (TRON_ADDR_FROM_PRIVKEY_0).
const TEST_TRON_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const EXPECTED_TRON_ADDRESS = 'TYBNgWfhGuNzdLtjKtxXTfskAhTbMcqbaG';
const EXPECTED_PREFIX = 'TYBNg';
const EXPECTED_SUFFIX = 'baG';
const TEST_PASSWORD = 'E2E-password-2026';

test("【钱包导入 / UI】 import Tron 私钥登陆 #walletPage 并具有预期的 Base58Check 地址", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await openPopup(ctx.context, ctx.extensionId);

    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });
    await byId(popup, 'welcomeImportWalletBtn').click();
    await byId(popup, 'importPage').waitFor({ state: 'visible' });
    await recorder.step(popup, '导入页', {
      note: '统一 UI：网络下拉（Ethereum/Tron/Solana/Bitcoin）+ 助记词/私钥 switch。',
    });

    // 选网络 = Tron，方法 = 私钥。reference 选择器会自动展开。
    await selectImportNetwork(popup, 'tron', 'privateKey');
    await expect(byId(popup, 'importReferenceGroup')).toBeVisible();
    await expect(byId(popup, 'privateKeyImportSection')).toBeVisible();

    await byId(popup, 'importPrivateKey').fill(TEST_TRON_PRIVATE_KEY);
    await byId(popup, 'importAccountName').fill('E2E Tron PK');
    await byId(popup, 'importWalletPassword').fill(TEST_PASSWORD);
    await recorder.step(popup, '填好 Tron 私钥、账户名、密码', {
      note: 'Tron 私钥格式与 EVM 相同（32 字节 hex，带 0x 前缀）；vault 层按 `tron` 链族派生地址。',
    });
    await byId(popup, 'importBtn').click();

    await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 30_000 });
    await recorder.step(popup, '导入完成，回到主页', {
      note: '地址 = privateKeyToTronAddress(priv, 0x41) 的 Base58Check 编码。',
    });

    const displayedAddress = (await byId(popup, 'accountAddress').textContent())?.trim() ?? '';
    // Popup truncates the address with a unicode/ASCII ellipsis; assert on
    // shape (Base58Check alphabet + the truncation marker) and on the
    // known prefix/suffix. The full address is cross-checked via the SW
    // message bus below.
    expect(displayedAddress).toMatch(/…|\.\.\./);
    const stripped = displayedAddress.replace(/…|\.\.\./g, '');
    expect(stripped).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(stripped).toContain(EXPECTED_PREFIX);
    expect(stripped).toContain(EXPECTED_SUFFIX);

    // Cross-check the *full* address through the SW message bus so the
    // truncation marker doesn't fool us. handleGetCurrentAccount wraps the
    // account under a `.account` key alongside `{ success: true }`.
    const response = await sendSw<{ success?: boolean; account?: { address: string; namespace: string; chainKey: string } }>(
      popup,
      'GET_CURRENT_ACCOUNT',
    );
    const currentAccount = response?.account;
    expect(currentAccount?.namespace).toBe('tron');
    expect(currentAccount?.chainKey).toBe('tron:mainnet');
    expect(currentAccount?.address).toBe(EXPECTED_TRON_ADDRESS);
  } finally {
    await teardownWalletContext(ctx);
  }
});