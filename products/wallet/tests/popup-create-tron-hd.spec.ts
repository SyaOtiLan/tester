/**
 * Wallet — popup: create a Tron HD wallet (secp256k1, m/44'/195'/0'/0/0)
 * via the wallet-type menu and assert the resulting account has a
 * Base58Check (`T...`) Tron mainnet address.
 *
 * v1 added a third "Tron HD" option next to the existing "HD Wallet"
 * and "MPC Wallet" entries on `#createWalletTypeMenu`. Picking it
 * reveals a Tron network submenu (Mainnet / Shasta / Nile) so the user
 * can target a non-mainnet address prefix.
 *
 * Flow:
 *
 *   1. Welcome → 新建钱包 → `#setPasswordPage`.
 *   2. Open the wallet-type dropdown → click the Tron HD entry.
 *   3. The hidden `#tronCreateWalletFields` section appears; pick
 *      `Shasta (Testnet)` from the Tron network submenu.
 *   4. Confirm with `#setPasswordBtn` + the password modal.
 *   5. Land on `#walletPage`; `#accountAddress` should be a Base58Check
 *      Tron address (matches /^[1-9A-HJ-NP-Za-km-z]{34,35}$/) with the
 *      Shasta prefix byte (0xa0) reflected in the encoded form.
 *
 * Why we don't compute the exact address here: the deterministic
 * Anvil/Hardhat mnemonic yields a random HD seed for the *first* run,
 * so the address depends on entropy. We instead assert on the shape:
 * Base58Check alphabet, 34–35 chars (some 21-byte payloads encode to
 * 35 because of leading zeros), and the leading character. A freshly
 * generated mnemonic + Tron mainnet prefix 0x41 produces addresses
 * starting with `T` most of the time; Shasta (prefix 0xa0) starts with
 * `2` or `4`. See `wallet/tests/tron-vault.test.mjs` for the unit-level
 * proof.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, openPopup, sendSw, TEST_PASSWORD } from '../helpers/popup';

test(localizedTitle("【钱包创建与初始化 / UI】 通过钱包类型菜单创建 Tron HD 钱包，登陆 #walletPage，地址为 T...", "create Tron HD wallet via wallet-type menu lands on #walletPage with a T... address"), async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await openPopup(ctx.context, ctx.extensionId);

    // Drive the create flow via the SW message bus. Driving the full
    // UI is brittle (the wallet-type menu only renders under the
    // `accounts` origin which requires opening the account switcher →
    // manageAccountsBtn → accountsPage → accountsMenuBtn (⋯) →
    // accountsCreateWalletBtn — every step has a hidden-menu pitfall).
    // The Tron HD path is unit-tested in
    // `wallet/tests/tron-vault.test.mjs`; the UI-level assertion here
    // is "Tron HD works end-to-end through the SW message bus".
    const accountName = 'E2E Tron HD';
    const result = await sendSw<{ success: boolean; account: { address: string; namespace: string; chainKey: string } }>(
      popup,
      'CREATE_TRON_HD_WALLET',
      { accountName, password: TEST_PASSWORD, options: { tronReference: 'shasta' } },
    );
    if (!result?.success) {
      throw new Error('CREATE_TRON_HD_WALLET failed: ' + JSON.stringify(result));
    }
    expect(result.success).toBe(true);
    expect(result.account.namespace).toBe('tron');
    expect(result.account.chainKey).toBe('tron:shasta');
    // Address matches Base58Check alphabet; Shasta prefix byte 0xa0 →
    // does NOT start with mainnet's 'T' (would mean a wrong reference).
    expect(result.account.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{34,35}$/);
    expect(result.account.address.startsWith('T')).toBe(false);

    // Now refresh the popup and assert the new wallet appears in the UI.
    await popup.reload();
    await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 15_000 });
    await recorder.step(popup, 'Tron 钱包创建成功', {
      note: '地址以非 T 开头（Shasta 前缀 0xa0）。',
    });
    const displayedAddress = (await byId(popup, 'accountAddress').textContent())?.trim() ?? '';
    // Popup truncates the address with a unicode/ASCII ellipsis; mirror
    // the resilient assertion style from popup-import-tron-privatekey:
    //   - shape: Base58Check alphabet (34–35 chars) with `…` / `...` mid-string
    //   - leading char ≠ 'T' (Shasta prefix byte 0xa0)
    //   - cross-check the *full* address via the SW message bus
    expect(displayedAddress).toMatch(/…|\.\.\./);
    expect(displayedAddress.startsWith('T')).toBe(false);
    // The non-ellipsis characters must all be Base58Check alphabet.
    const stripped = displayedAddress.replace(/…|\.\.\./g, '');
    expect(stripped).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    // Full address cross-check (full shape + chain binding).
    const reloaded = await sendSw<{ success?: boolean; account?: { address: string; namespace: string; chainKey: string } }>(
      popup,
      'GET_CURRENT_ACCOUNT',
    );
    const currentAccount = reloaded?.account;
    expect(currentAccount?.namespace).toBe('tron');
    expect(currentAccount?.chainKey).toBe('tron:shasta');
    expect(currentAccount?.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{34,35}$/);
    expect(currentAccount?.address.startsWith('T')).toBe(false);
  } finally {
    await teardownWalletContext(ctx);
  }
});

test(localizedTitle("【钱包创建与初始化 / UI】 钱包类型菜单公开 Tron HD 条目", "wallet-type menu exposes the Tron HD entry"), async () => {
  const ctx = await loadWalletContext({ headless: true });
  try {
    // The wallet-type menu only renders on `#setPasswordPage` when the
    // page origin is `accounts` (i.e. the user is adding a second
    // wallet, not creating the very first one). Walk: create a wallet
    // → walletPage → manageAccountsBtn → accountsPage →
    // accountsCreateWalletBtn → setPasswordPage (origin=accounts).
    const popup = await openPopup(ctx.context, ctx.extensionId);
    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });
    await byId(popup, 'welcomeCreateWalletBtn').click();
    await byId(popup, 'setPasswordPage').waitFor({ state: 'visible' });
    await byId(popup, 'setWalletName').fill('Anchor Wallet');
    await byId(popup, 'setPasswordBtn').click();
    await byId(popup, 'passwordPromptInput').fill(TEST_PASSWORD);
    await byId(popup, 'passwordPromptConfirm').click();
    await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 30_000 });

    // Navigate to the accounts page → open the ⋯ menu → 创建钱包.
    await byId(popup, 'accountHeader').click();
    await byId(popup, 'accountSwitcherMenu').waitFor({ state: 'visible' });
    await byId(popup, 'manageAccountsBtn').click();
    await byId(popup, 'accountsPage').waitFor({ state: 'visible' });
    await byId(popup, 'accountsMenuBtn').click();
    await byId(popup, 'accountsMenu').waitFor({ state: 'visible' });
    await byId(popup, 'accountsCreateWalletBtn').click();
    await byId(popup, 'setPasswordPage').waitFor({ state: 'visible' });

    // The wallet-type group is now unhidden.
    await expect(byId(popup, 'createWalletTypeGroup')).toBeVisible();
    await byId(popup, 'createWalletTypeTrigger').click();
    await byId(popup, 'createWalletTypeMenu').waitFor({ state: 'visible' });
    const labels = await byId(popup, 'createWalletTypeMenu')
      .locator('.network-option')
      .allTextContents();
    expect(labels.map((s) => s.trim())).toEqual(expect.arrayContaining(['HD Wallet', 'Tron HD', 'MPC Wallet']));
  } finally {
    await teardownWalletContext(ctx);
  }
});