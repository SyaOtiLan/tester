/**
 * Wallet — popup: account management (add / switch / rename).
 *
 * A fresh wallet created via the welcome flow is an HD wallet, so it can
 * derive additional accounts. This spec drives the three account-management
 * flows a real user hits from the popup:
 *
 *   1. Add a second (derived) account from the accounts-management page.
 *   2. Switch the active account from the header switcher.
 *   3. Rename an account from the account-detail page.
 *
 * All selectors verified against `wallet/html/popup.html` and the
 * account controllers under `js/controller/account/`.
 */
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, createAndUnlockWallet, TEST_PASSWORD } from '../helpers/popup';

/**
 * Some account actions (switch, add, delete) re-prompt for the wallet
 * password via a dynamically-created `#passwordPromptModal`. Fill it if it
 * shows within a short window; otherwise carry on.
 */
async function fillPasswordPromptIfShown(popup: import('@playwright/test').Page) {
  const modal = popup.locator('#passwordPromptModal');
  const shown = await modal
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (shown) {
    await popup.locator('#passwordPromptInput').fill(TEST_PASSWORD);
    await popup.locator('#passwordPromptConfirm').click();
    await modal.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
  }
}

test("【账户管理 / UI】 添加第二个 HD 帐户，然后从标题切换器切换到该帐户", async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);
    await recorder.step(popup, '创建并解锁钱包，进入主页');

    // Open the account switcher → manage accounts.
    await byId(popup, 'accountHeader').click();
    await byId(popup, 'accountSwitcherMenu').waitFor({ state: 'visible' });
    // Exactly one account to start with.
    const switcherItems = popup.locator('#accountSwitcherList .account-switcher-item');
    await expect(switcherItems).toHaveCount(1);

    await byId(popup, 'manageAccountsBtn').click();
    await byId(popup, 'accountsPage').waitFor({ state: 'visible' });
    await recorder.step(popup, '打开账户管理页');

    // Add a derived account (HD wallets show an "添加账户" row).
    const addAccount = popup.locator('#walletList .add-account-item').first();
    await addAccount.waitFor({ state: 'visible' });
    await addAccount.click();

    await byId(popup, 'createAccountModal').waitFor({ state: 'visible' });
    await byId(popup, 'newAccountName').fill('E2E Second');
    await byId(popup, 'confirmCreateAccount').click();
    await fillPasswordPromptIfShown(popup);
    await byId(popup, 'createAccountModal').waitFor({ state: 'hidden', timeout: 10_000 });
    await recorder.step(popup, '新增第二个派生账户');

    // The accounts list should now show two account rows.
    await expect(popup.locator('#walletList .account-item')).toHaveCount(2, { timeout: 10_000 });

    // Return to the wallet page (some builds auto-return after add).
    if (!(await byId(popup, 'walletPage').isVisible())) {
      await popup.locator('#accountsPage .back-btn:visible').first().click();
    }
    await byId(popup, 'walletPage').waitFor({ state: 'visible' });

    const activeBefore = (await byId(popup, 'accountName').textContent())?.trim();

    await byId(popup, 'accountHeader').click();
    await byId(popup, 'accountSwitcherMenu').waitFor({ state: 'visible' });
    await expect(popup.locator('#accountSwitcherList .account-switcher-item')).toHaveCount(2);
    // Click the item that is NOT currently active.
    const inactive = popup
      .locator('#accountSwitcherList .account-switcher-item:not(.active)')
      .first();
    await inactive.click();
    await fillPasswordPromptIfShown(popup);
    await recorder.step(popup, '切换到另一个账户');

    // Header name should have changed to the other account.
    await expect
      .poll(async () => (await byId(popup, 'accountName').textContent())?.trim())
      .not.toBe(activeBefore);
  } finally {
    await teardownWalletContext(ctx);
  }
});

test("【账户管理 / UI】 从详细信息页面重命名帐户会保留新名称", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);

    await byId(popup, 'accountHeader').click();
    await byId(popup, 'accountSwitcherMenu').waitFor({ state: 'visible' });
    await byId(popup, 'manageAccountsBtn').click();
    await byId(popup, 'accountsPage').waitFor({ state: 'visible' });

    // Open the first account's detail page.
    await popup.locator('#walletList .account-item').first().click();
    await byId(popup, 'accountDetailPage').waitFor({ state: 'visible' });
    await recorder.step(popup, '进入账户详情页');

    // Enter edit mode, type a new name, save. The name input caps at 20
    // chars, so keep it short.
    const newName = 'Renamed E2E';
    await byId(popup, 'editAccountNameBtn').click();
    const nameInput = byId(popup, 'accountDetailNameInput');
    await nameInput.waitFor({ state: 'visible' });
    await nameInput.fill(newName);
    await byId(popup, 'saveAccountNameBtn').click();
    await recorder.step(popup, '重命名账户并保存');

    await expect(byId(popup, 'accountDetailNameText')).toHaveText(newName, { timeout: 10_000 });
  } finally {
    await teardownWalletContext(ctx);
  }
});

test("【账户管理 / UI】 WL-UI-013 删除 / 移除账户", async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);

    // Open accounts management and add a second derived account so we can
    // delete one without emptying the wallet.
    await byId(popup, 'accountHeader').click();
    await byId(popup, 'accountSwitcherMenu').waitFor({ state: 'visible' });
    await byId(popup, 'manageAccountsBtn').click();
    await byId(popup, 'accountsPage').waitFor({ state: 'visible' });

    await popup.locator('#walletList .add-account-item').first().click();
    await byId(popup, 'createAccountModal').waitFor({ state: 'visible' });
    await byId(popup, 'newAccountName').fill('E2E Disposable');
    await byId(popup, 'confirmCreateAccount').click();
    await fillPasswordPromptIfShown(popup);
    await byId(popup, 'createAccountModal').waitFor({ state: 'hidden', timeout: 10_000 });

    // Adding an account may bounce back to the wallet page — re-open the
    // accounts page so the list is actually visible before we delete.
    if (!(await byId(popup, 'accountsPage').isVisible())) {
      if (!(await byId(popup, 'walletPage').isVisible())) {
        await popup.locator('#accountsPage .back-btn:visible').first().click().catch(() => {});
      }
      await byId(popup, 'walletPage').waitFor({ state: 'visible' });
      await byId(popup, 'accountHeader').click();
      await byId(popup, 'accountSwitcherMenu').waitFor({ state: 'visible' });
      await byId(popup, 'manageAccountsBtn').click();
      await byId(popup, 'accountsPage').waitFor({ state: 'visible' });
    }
    await expect(popup.locator('#walletList .account-item')).toHaveCount(2, { timeout: 10_000 });
    await recorder.step(popup, '准备好两个账户，即将删除其一');

    // Delete the second account via its 🗑️ button → confirm modal →
    // password prompt. The row's action buttons only reveal on hover, so
    // hover the row first, then force the click.
    const secondItem = popup.locator('#walletList .account-item').nth(1);
    await secondItem.scrollIntoViewIfNeeded();
    await secondItem.hover();
    await secondItem.locator('.delete-btn').click({ force: true });
    await popup.locator('#deleteAccountModal').waitFor({ state: 'visible' });
    await popup.locator('#confirmDeleteAccount').click();

    const prompt = popup.locator('#passwordPromptModal');
    await prompt.waitFor({ state: 'visible', timeout: 10_000 });
    await popup.locator('#passwordPromptInput').fill(TEST_PASSWORD);
    await popup.locator('#passwordPromptConfirm').click();
    await recorder.step(popup, '输入密码确认删除');

    // Back to a single account, and the success toast confirms removal.
    await expect(byId(popup, 'globalToast')).toContainText('账户已删除', { timeout: 10_000 });
    await expect(popup.locator('#walletList .account-item')).toHaveCount(1, { timeout: 10_000 });
    await recorder.step(popup, '账户已删除，仅剩一个');
  } finally {
    await teardownWalletContext(ctx);
  }
});
