/**
 * Wallet — popup: security flows (reveal secrets + change password).
 *
 * Two independent user journeys through the popup's security surface:
 *
 *   1. Reveal secrets with the wallet password:
 *      - accounts page → 🔑 (view-private-key-btn) → password prompt →
 *        `#secretDisplayValue` holds a 0x + 64-hex private key.
 *      - accounts page → view-mnemonic-btn → password prompt →
 *        `#secretDisplayValue` holds a 12-word mnemonic.
 *   2. Change the wallet password, then lock and unlock with the *new*
 *      password to prove it took effect.
 *
 * Selectors verified against `wallet/html/popup.html` and the account
 * controllers under `js/controller/account/`. The password prompt is the
 * dynamic `#passwordPromptModal` (same one popup-accounts fills).
 */
import { localizedTitle } from '../../../shared/title';
import type { Page } from '@playwright/test';

import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, createAndUnlockWallet, TEST_PASSWORD } from '../helpers/popup';

/** Fill the dynamic password-prompt modal (required to appear). */
async function fillPasswordPrompt(popup: Page, password = TEST_PASSWORD) {
  const modal = popup.locator('#passwordPromptModal');
  await modal.waitFor({ state: 'visible', timeout: 10_000 });
  await popup.locator('#passwordPromptInput').fill(password);
  await popup.locator('#passwordPromptConfirm').click();
}

/** Navigate walletPage → accounts management page. */
async function openAccountsPage(popup: Page) {
  await byId(popup, 'accountHeader').click();
  await byId(popup, 'accountSwitcherMenu').waitFor({ state: 'visible' });
  await byId(popup, 'manageAccountsBtn').click();
  await byId(popup, 'accountsPage').waitFor({ state: 'visible' });
}

test(localizedTitle("【安全与备份恢复 / UI】 通过密码从账户页面显示助记词和私钥", "reveal mnemonic and private key from the accounts page with the password"), async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);
    await openAccountsPage(popup);
    await recorder.step(popup, '打开账户管理页');

    // --- Mnemonic (HD wallet header 🗎 button) ---
    await popup.locator('#walletList .view-mnemonic-btn').first().click();
    await fillPasswordPrompt(popup);
    await byId(popup, 'secretDisplayModal').waitFor({ state: 'visible', timeout: 10_000 });
    const mnemonic = (await byId(popup, 'secretDisplayValue').inputValue()).trim();
    await recorder.step(popup, '展示助记词');
    // A BIP-39 mnemonic is 12 (or 24) space-separated words.
    const words = mnemonic.split(/\s+/).filter(Boolean);
    expect([12, 15, 18, 21, 24]).toContain(words.length);
    await byId(popup, 'confirmSecretDisplayBtn').click();
    await byId(popup, 'secretDisplayModal').waitFor({ state: 'hidden', timeout: 10_000 });

    // --- Private key (per-account 🔑 button) ---
    await popup.locator('#walletList .view-private-key-btn').first().click();
    await fillPasswordPrompt(popup);
    await byId(popup, 'secretDisplayModal').waitFor({ state: 'visible', timeout: 10_000 });
    const privateKey = (await byId(popup, 'secretDisplayValue').inputValue()).trim();
    await recorder.step(popup, '展示私钥');
    // 32-byte secp256k1 private key: 0x + 64 hex chars.
    expect(privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
    await byId(popup, 'confirmSecretDisplayBtn').click();
  } finally {
    await teardownWalletContext(ctx);
  }
});

test(localizedTitle("【安全与备份恢复 / UI】 更改钱包密码，然后用新密码锁定和解锁", "change the wallet password, then lock and unlock with the new one"), async ({ recorder }) => {
  const ctx = await loadWalletContext();
  const NEW_PASSWORD = 'E2E-password-2027';
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);

    // Open settings → change password modal.
    await byId(popup, 'walletHeaderMenuBtn').click();
    await byId(popup, 'walletHeaderMenu').waitFor({ state: 'visible' });
    await byId(popup, 'settingsBtn').click();
    await byId(popup, 'settingsPage').waitFor({ state: 'visible' });
    await byId(popup, 'changePasswordBtn').click();
    await byId(popup, 'changePasswordModal').waitFor({ state: 'visible' });
    await recorder.step(popup, '打开修改密码弹窗');

    await byId(popup, 'oldPasswordInput').fill(TEST_PASSWORD);
    await byId(popup, 'newPasswordInput').fill(NEW_PASSWORD);
    await byId(popup, 'confirmNewPasswordInput').fill(NEW_PASSWORD);
    await byId(popup, 'confirmChangePasswordBtn').click();
    await byId(popup, 'changePasswordModal').waitFor({ state: 'hidden', timeout: 15_000 });
    await recorder.step(popup, '密码已修改');

    // Return to the wallet page and lock the wallet.
    if (!(await byId(popup, 'walletPage').isVisible())) {
      await popup.locator('#settingsPage .back-btn:visible').first().click();
    }
    await byId(popup, 'walletPage').waitFor({ state: 'visible' });
    await byId(popup, 'walletHeaderMenuBtn').click();
    await byId(popup, 'walletHeaderMenu').waitFor({ state: 'visible' });
    await byId(popup, 'lockWalletBtn').click();
    await byId(popup, 'unlockPage').waitFor({ state: 'visible', timeout: 10_000 });
    await recorder.step(popup, '钱包已锁定');

    // The old password must NOT unlock; the new one must.
    await byId(popup, 'unlockPassword').fill(TEST_PASSWORD);
    await byId(popup, 'unlockBtn').click();
    // Still locked after a wrong password (give the toast a beat, then assert).
    await expect(byId(popup, 'unlockPage')).toBeVisible();

    await byId(popup, 'unlockPassword').fill(NEW_PASSWORD);
    await byId(popup, 'unlockBtn').click();
    await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 15_000 });
    await recorder.step(popup, '用新密码解锁成功');
  } finally {
    await teardownWalletContext(ctx);
  }
});

test(localizedTitle("【安全与锁定恢复 / UI】 WL-UI-024 使用错误密码查看私钥/助记词被拒绝", "WL-UI-024: a wrong password when revealing the private key is rejected"), async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);
    await openAccountsPage(popup);

    // Open the reveal flow, then submit a WRONG (but ≥8-char) password.
    await popup.locator('#walletList .view-private-key-btn').first().click();
    const prompt = popup.locator('#passwordPromptModal');
    await prompt.waitFor({ state: 'visible', timeout: 10_000 });
    await popup.locator('#passwordPromptInput').fill('totally-wrong-1');
    await popup.locator('#passwordPromptConfirm').click();
    await recorder.step(popup, '输入错误密码尝试查看私钥');

    // An error toast appears; the prompt stays open and the secret is never
    // shown.
    await expect(byId(popup, 'globalToast')).toBeVisible({ timeout: 10_000 });
    await expect(prompt).toBeVisible();
    await expect(byId(popup, 'secretDisplayModal')).toBeHidden();
    await recorder.step(popup, '错误密码被拒绝，未泄露私钥');
  } finally {
    await teardownWalletContext(ctx);
  }
});

test(localizedTitle("【安全与锁定恢复 / UI】 WL-UI-025 修改密码时旧密码错误被拒绝", "WL-UI-025: changing the password with a wrong old password is rejected"), async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  const NEW_PASSWORD = 'E2E-password-9999';
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);

    await byId(popup, 'walletHeaderMenuBtn').click();
    await byId(popup, 'walletHeaderMenu').waitFor({ state: 'visible' });
    await byId(popup, 'settingsBtn').click();
    await byId(popup, 'settingsPage').waitFor({ state: 'visible' });
    await byId(popup, 'changePasswordBtn').click();
    await byId(popup, 'changePasswordModal').waitFor({ state: 'visible' });

    // Wrong current password, valid + matching new password.
    await byId(popup, 'oldPasswordInput').fill('this-is-not-the-password');
    await byId(popup, 'newPasswordInput').fill(NEW_PASSWORD);
    await byId(popup, 'confirmNewPasswordInput').fill(NEW_PASSWORD);
    await recorder.step(popup, '用错误的旧密码尝试修改');
    await byId(popup, 'confirmChangePasswordBtn').click();

    // Rejected: error toast, modal stays open.
    await expect(byId(popup, 'globalToast')).toContainText('修改失败', { timeout: 10_000 });
    await expect(byId(popup, 'changePasswordModal')).toBeVisible();
    await recorder.step(popup, '错误旧密码被拒绝');

    // Prove the password was NOT changed: the original one still unlocks.
    // Close the modal, lock, and unlock with the ORIGINAL password.
    await popup.locator('#changePasswordModal .modal-close, #changePasswordModal .btn-secondary')
      .first()
      .click()
      .catch(() => {});
    if (!(await byId(popup, 'walletPage').isVisible())) {
      await popup.locator('#settingsPage .back-btn:visible').first().click().catch(() => {});
    }
    await byId(popup, 'walletPage').waitFor({ state: 'visible' });
    await byId(popup, 'walletHeaderMenuBtn').click();
    await byId(popup, 'walletHeaderMenu').waitFor({ state: 'visible' });
    await byId(popup, 'lockWalletBtn').click();
    await byId(popup, 'unlockPage').waitFor({ state: 'visible', timeout: 10_000 });
    await byId(popup, 'unlockPassword').fill(TEST_PASSWORD);
    await byId(popup, 'unlockBtn').click();
    await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 15_000 });
    await recorder.step(popup, '原密码仍可解锁，证明未被修改');
  } finally {
    await teardownWalletContext(ctx);
  }
});
