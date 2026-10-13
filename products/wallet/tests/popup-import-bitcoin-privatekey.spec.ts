/**
 * Wallet — popup: import a Bitcoin private key and assert the derived
 * account address is the expected P2WPKH (native segwit) bech32 address.
 *
 * Mirrors `popup-import-solana-privatekey.spec.ts` but exercises the
 * Bitcoin tab:
 *
 *   `.import-method-tab[data-type="privateKey"][data-chain="bitcoin"]`
 *
 * Vector: the well-known Hardhat/Anvil secp256k1 account #0 private key.
 * Bitcoin reuses the same secp256k1 curve as EVM, so the 32 sk bytes map
 * to a compressed pubkey → hash160 → bech32 P2WPKH address:
 *
 *   0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
 *     → bc1q5428vq2uzwhm3taey9sr9x5vm6tk78ew0wt525  (mainnet P2WPKH)
 *
 * We assert on the truncated head/tail in the popup and the full address
 * through the SW message bus.
 */
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, openPopup, sendSw, selectImportNetwork } from '../helpers/popup';

// Hardhat/Anvil account #0 — same vector used by the Solana/Tron import specs.
const TEST_BITCOIN_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const EXPECTED_BITCOIN_ADDRESS = 'bc1q5428vq2uzwhm3taey9sr9x5vm6tk78ew0wt525';
const TEST_PASSWORD = 'E2E-password-2026';

test("【钱包导入 / UI】 import Bitcoin 私钥登陆 #walletPage 并具有预期的 P2WPKH 地址", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await openPopup(ctx.context, ctx.extensionId);

    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });
    await byId(popup, 'welcomeImportWalletBtn').click();
    await byId(popup, 'importPage').waitFor({ state: 'visible' });
    await recorder.step(popup, '导入页', {
      note: '统一 UI：网络下拉 + 助记词/私钥 switch；选 Bitcoin 即出现 mainnet/testnet。',
    });

    // 选网络 = Bitcoin，方法 = 私钥。
    await selectImportNetwork(popup, 'bitcoin', 'privateKey');
    await expect(byId(popup, 'importReferenceGroup')).toBeVisible();
    await expect(byId(popup, 'privateKeyImportSection')).toBeVisible();

    await byId(popup, 'importPrivateKey').fill(TEST_BITCOIN_PRIVATE_KEY);
    await byId(popup, 'importAccountName').fill('E2E Bitcoin PK');
    await byId(popup, 'importWalletPassword').fill(TEST_PASSWORD);
    await recorder.step(popup, '填好 Bitcoin 私钥、账户名、密码', {
      note: 'Bitcoin 复用 secp256k1；私钥字节 → 压缩公钥 → hash160 → bech32 P2WPKH。',
    });
    await byId(popup, 'importBtn').click();

    await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 30_000 });
    await recorder.step(popup, '导入完成，回到主页', {
      note: '地址 = privateKeyToBitcoinAddress(priv, mainnet) 的 bech32 P2WPKH 编码。',
    });

    const displayedAddress = (await byId(popup, 'accountAddress').textContent())?.trim() ?? '';
    // Popup truncates as "<head>…<tail>"; assert head/tail are genuine
    // prefix/suffix of the known full address (exact lengths are a popup
    // rendering detail). Full address cross-checked via the SW bus below.
    expect(displayedAddress).toMatch(/…|\.\.\./);
    const [head, tail] = displayedAddress.split(/…|\.\.\./);
    expect(EXPECTED_BITCOIN_ADDRESS.startsWith(head)).toBe(true);
    expect(EXPECTED_BITCOIN_ADDRESS.endsWith(tail)).toBe(true);

    const response = await sendSw<{ success?: boolean; account?: { address: string; namespace: string; chainKey: string } }>(
      popup,
      'GET_CURRENT_ACCOUNT',
    );
    const currentAccount = response?.account;
    expect(currentAccount?.namespace).toBe('bip122');
    expect(currentAccount?.chainKey).toBe('bip122:mainnet');
    expect(currentAccount?.address).toBe(EXPECTED_BITCOIN_ADDRESS);
  } finally {
    await teardownWalletContext(ctx);
  }
});
