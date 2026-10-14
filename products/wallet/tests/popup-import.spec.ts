/**
 * Wallet — popup smoke: import a known mnemonic and verify the derived
 * address matches the deterministic Hardhat/Anvil account #0.
 *
 * Mirrors the second test in `wallet/tests/e2e/extension-smoke.test.mjs`.
 * The mnemonic is the well-known Hardhat/Anvil test vector:
 *
 *   test test test test test test test test test test test junk
 *     → 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
 *
 * If this fails because the address no longer matches, the mnemonic
 * changed upstream — verify with the wallet repo's existing test first.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, openPopup } from '../helpers/popup';

const TEST_MNEMONIC = 'test test test test test test test test test test test junk';
const TEST_PASSWORD = 'E2E-password-2026';
const TEST_WALLET_NAME = 'Imported E2E Wallet';

test(localizedTitle("【钱包导入 / UI】 import 助记词登陆 #walletPage 并带有预期的账户地址", "import mnemonic lands on #walletPage with the expected account address"), async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await openPopup(ctx.context, ctx.extensionId);

    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });
    await recorder.step(popup, '欢迎页（点击导入）', {
      note: '已有钱包的用户从这里导入助记词 / 私钥。',
    });
    await byId(popup, 'welcomeImportWalletBtn').click();
    await byId(popup, 'importPage').waitFor({ state: 'visible' });
    await recorder.step(popup, '导入页', {
      note: '默认助记词开关 + Ethereum 网络；可切换私钥 / Solana / Tron / Bitcoin。',
    });

    // 新 UI 默认 method=mnemonic, network=evm —— 仅断言默认 method 即足够防止回归。
    await expect(popup.locator('.import-method-option.active')).toHaveAttribute('data-method', 'mnemonic');

    await byId(popup, 'importMnemonic').fill(TEST_MNEMONIC);
    await byId(popup, 'importAccountName').fill(TEST_WALLET_NAME);
    await byId(popup, 'importWalletPassword').fill(TEST_PASSWORD);
    await byId(popup, 'importBtn').click();

    await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 30_000 });
    await recorder.step(popup, '导入完成，回到主页', {
      note: '地址是 Anvil/Hardhat 测试账户 #0 的截断形式。',
    });

    // The popup renders the address in truncated form (e.g. `0xf39...92266`),
    // matching the Anvil/Hardhat default account #0. Asserting on the
    // truncated shape (prefix + suffix separated by `...` or `…`) matches
    // the wallet repo's own smoke test and is resilient to unicode
    // ellipsis changes across versions.
    const address = (await byId(popup, 'accountAddress').textContent())?.trim() ?? '';
    const EXPECTED_PREFIX = '0xf39';
    const EXPECTED_SUFFIX = '92266';
    expect(address.toLowerCase()).toContain(EXPECTED_PREFIX);
    expect(address.toLowerCase()).toContain(EXPECTED_SUFFIX);
    // And the truncation marker is present so we know we're comparing the
    // truncated representation, not some other screen.
    expect(address).toMatch(/…|\.\.\./);
  } finally {
    await teardownWalletContext(ctx);
  }
});