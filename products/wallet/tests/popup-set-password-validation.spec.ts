/**
 * Wallet — popup: set-password validation on wallet creation (WL-UI-005).
 *
 * The create flow ends in a dynamic password prompt (`#passwordPromptModal`)
 * whose `onConfirm` enforces a minimum length (≥ 8). An empty submission is
 * rejected before `onConfirm` even runs ('请输入密码'); a too-short password
 * is rejected by `onConfirm` ('密码至少需要8位字符'). In both cases the wallet
 * must NOT be created — we never reach `#walletPage`.
 *
 * Verified against `js/controller/wallet/create-wallet-controller.js`
 * (onConfirm throws '密码至少需要8位字符') and the shared `promptPassword`
 * in `js/controller/account/account-modals-controller.js` (empty → toast,
 * error keeps the modal open).
 *
 * NB: this create flow has a single password field (no confirm box), so the
 * "two entries differ" branch of WL-UI-005 does not apply here; we assert the
 * behavior that actually runs — empty and too-short are rejected.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, openPopup, TEST_WALLET_NAME, TEST_PASSWORD } from '../helpers/popup';

test(localizedTitle("【钱包创建与初始化 / UI】 WL-UI-005 设置密码时两次输入不一致 / 空密码被拒绝", "WL-UI-005: empty and too-short passwords are rejected and no wallet is created"), async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await openPopup(ctx.context, ctx.extensionId);

    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });
    await byId(popup, 'welcomeCreateWalletBtn').click();
    await byId(popup, 'setPasswordPage').waitFor({ state: 'visible' });
    await byId(popup, 'setWalletName').fill(TEST_WALLET_NAME);
    await byId(popup, 'setPasswordBtn').click();

    const modal = popup.locator('#passwordPromptModal');
    await modal.waitFor({ state: 'visible' });
    await recorder.step(popup, '进入设置密码提示框');

    // -- Empty password --------------------------------------------------
    await byId(popup, 'passwordPromptInput').fill('');
    await byId(popup, 'passwordPromptConfirm').click();
    await expect(byId(popup, 'globalToast')).toContainText('请输入密码', { timeout: 10_000 });
    await expect(modal).toBeVisible();
    await expect(byId(popup, 'walletPage')).toBeHidden();
    await recorder.step(popup, '空密码被拒绝');

    // -- Too-short password (< 8) ---------------------------------------
    await byId(popup, 'passwordPromptInput').fill('1234567');
    await byId(popup, 'passwordPromptConfirm').click();
    await expect(byId(popup, 'globalToast')).toContainText('密码至少需要8位字符', { timeout: 10_000 });
    await expect(modal).toBeVisible();
    await expect(byId(popup, 'walletPage')).toBeHidden();
    await recorder.step(popup, '过短密码被拒绝');

    // -- A valid password finally succeeds (proves the form was usable) --
    await byId(popup, 'passwordPromptInput').fill(TEST_PASSWORD);
    await byId(popup, 'passwordPromptConfirm').click();
    await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 30_000 });
    await recorder.step(popup, '合法密码通过并进入主页');
  } finally {
    await teardownWalletContext(ctx);
  }
});
