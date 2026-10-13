/**
 * Wallet — popup: import a known private key and verify the derived
 * account address (WL-UI-007).
 *
 * Complements `popup-import.spec.ts` (mnemonic import). Here we exercise
 * the 私钥 (private key) tab of `#importPage`:
 *
 *   1. Welcome → 导入钱包 → `#importPage`.
 *   2. Click the `.import-tab[data-type=privateKey]` tab; the
 *      `#privateKeyImportSection` becomes visible.
 *   3. Fill `#importPrivateKey`, `#importAccountName`, `#importWalletPassword`
 *      and submit `#importBtn`.
 *   4. Land on `#walletPage`; `#accountAddress` is the truncated form of the
 *      address that corresponds to the private key.
 *
 * We use the well-known Hardhat/Anvil account #1 vector (distinct from the
 * mnemonic default #0 used by popup-import.spec.ts):
 *
 *   0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
 *     → 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
 *
 * Asserting on the truncated prefix/suffix matches the resilient approach in
 * popup-import.spec.ts (tolerant of unicode-ellipsis changes across versions).
 */
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, openPopup } from '../helpers/popup';

// Hardhat/Anvil account #1 private key + its expected address.
const TEST_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const EXPECTED_PREFIX = '0x709';
const EXPECTED_SUFFIX = '79c8';
const TEST_PASSWORD = 'E2E-password-2026';
const TEST_ACCOUNT_NAME = 'PrivateKey E2E Wallet';

test("【钱包导入 / UI】 导入私钥登陆 #walletPage 以及预期的账户地址", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await openPopup(ctx.context, ctx.extensionId);

    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });
    await byId(popup, 'welcomeImportWalletBtn').click();
    await byId(popup, 'importPage').waitFor({ state: 'visible' });
    await recorder.step(popup, '导入页（默认助记词 + Ethereum 网络）', {
      note: '切到「私钥」开关即可；网络选择器默认 Ethereum，无需改动。',
    });

    // 新 UI：默认网络 = EVM；点私钥开关（代替旧的 .import-tab[data-type=privateKey][data-chain=evm]）
    await byId(popup, 'importMethodPrivateKeyOption').click();
    await expect(popup.locator('.import-method-option.active')).toHaveAttribute('data-method', 'privateKey');
    await expect(popup.locator('#privateKeyImportSection')).toBeVisible();

    await byId(popup, 'importPrivateKey').fill(TEST_PRIVATE_KEY);
    await byId(popup, 'importAccountName').fill(TEST_ACCOUNT_NAME);
    await byId(popup, 'importWalletPassword').fill(TEST_PASSWORD);
    await recorder.step(popup, '填好私钥、账户名与密码', {
      note: '私钥输入框是 password 类型，避免旁人窥屏。',
    });
    await byId(popup, 'importBtn').click();

    await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 30_000 });
    await recorder.step(popup, '导入完成，回到主页', {
      note: '地址应为该私钥（Hardhat 账户 #1）对应地址的截断形式。',
    });

    const address = (await byId(popup, 'accountAddress').textContent())?.trim() ?? '';
    expect(address.toLowerCase()).toContain(EXPECTED_PREFIX);
    expect(address.toLowerCase()).toContain(EXPECTED_SUFFIX);
    // Truncation marker present → we're comparing the truncated representation.
    expect(address).toMatch(/…|\.\.\./);
  } finally {
    await teardownWalletContext(ctx);
  }
});
