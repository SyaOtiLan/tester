/**
 * Wallet — popup: address book (contacts) add + reuse in a transfer (WL-UI-033).
 *
 * A user opens 好友管理 (`#contactsPage`) from the wallet header menu, adds a
 * contact via `#contactEditorModal`, then on the transfer page picks that
 * contact from `#contactSelectorBtn` to auto-fill `#recipientAddress`.
 *
 * Selectors verified against `wallet/html/popup.html` and
 * `js/controller/contact-controller.js` (`handleAddContact` →
 * `showSuccess('联系人已添加')`; `renderContactSelect` fills `#contactMenu`
 * with `.network-option[data-address]` that set `#recipientAddress` on click).
 * The background lowercases stored addresses (`js/background/operations/contacts.js`),
 * so we assert the filled value against the option's own `data-address`.
 */
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, createAndUnlockWallet, openTransferPage } from '../helpers/popup';

const CONTACT_NAME = 'Alice E2E';
const CONTACT_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

test("【转账与交易 / UI】 WL-UI-033 通讯录新增联系人并在转账中选用", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);

    // Open 好友管理 from the header menu.
    await byId(popup, 'walletHeaderMenuBtn').click();
    await byId(popup, 'walletHeaderMenu').waitFor({ state: 'visible' });
    await popup.locator('#contactsBtn').click();
    await byId(popup, 'contactsPage').waitFor({ state: 'visible' });
    await recorder.step(popup, '进入通讯录页');

    // Add a contact.
    await popup.locator('#openAddContactBtn').click();
    await byId(popup, 'contactEditorModal').waitFor({ state: 'visible' });
    await byId(popup, 'contactNameInput').fill(CONTACT_NAME);
    await byId(popup, 'contactAddressInput').fill(CONTACT_ADDRESS);
    await recorder.step(popup, '填写联系人姓名与地址');
    await popup.locator('#addContactBtn').click();

    await expect(byId(popup, 'globalToast')).toContainText('联系人已添加', { timeout: 10_000 });
    await byId(popup, 'contactEditorModal').waitFor({ state: 'hidden', timeout: 10_000 });
    const contactRow = popup.locator('#contactsList .contact-item', { hasText: CONTACT_NAME });
    await expect(contactRow).toBeVisible({ timeout: 10_000 });
    await recorder.step(popup, '联系人出现在列表');

    // Back to the wallet page, then into the transfer page.
    await popup.locator('#contactsPage .back-btn:visible').first().click();
    await byId(popup, 'walletPage').waitFor({ state: 'visible' });
    await openTransferPage(popup);

    // Open the contact selector and pick the contact.
    await byId(popup, 'contactSelectorBtn').click();
    const menu = popup.locator('#contactMenu');
    await menu.waitFor({ state: 'visible' });
    const option = menu.locator('.network-option[data-address]', { hasText: CONTACT_NAME }).first();
    await option.waitFor({ state: 'visible', timeout: 5_000 });
    const optionAddress = await option.getAttribute('data-address');
    expect(optionAddress).toBeTruthy();
    await option.click();
    await recorder.step(popup, '从通讯录选中联系人');

    // The recipient field is auto-filled with the contact's address.
    await expect(byId(popup, 'recipientAddress')).toHaveValue(optionAddress!, { timeout: 5_000 });
    expect(optionAddress!.toLowerCase()).toBe(CONTACT_ADDRESS.toLowerCase());
  } finally {
    await teardownWalletContext(ctx);
  }
});
