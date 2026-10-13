/**
 * Wallet — popup: the passkey (通行证) registration UI exposes the
 * authenticator-type selector + device-name input (task152).
 *
 * task152 replaced the single "注册通行证" action with an explicit choice of
 * authenticator type (本机生物识别 platform / 手机扫码·安全密钥 cross-platform)
 * plus a custom device-name field, so a user can bind multiple distinct
 * authenticators. Reaching the live page needs a verified wallet identity
 * (heavy backend setup), so this is a DOM-contract check: it asserts the
 * registration form elements exist with the correct structure inside
 * `#walletIdentityPasskeyPage`. If the type selector is removed or its options
 * drift, this fails.
 *
 * Verified against `html/popup.html` (walletIdentityPasskeyPage footer) and
 * `js/controller/setting/wallet-identity-settings-controller.js`
 * (readPasskeyRegisterForm reads #walletIdentityPasskeyTypeSelect /
 * #walletIdentityPasskeyDeviceNameInput).
 */
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, openPopup } from '../helpers/popup';

interface FormContract {
  typeSelectInPage: boolean;
  typeOptionValues: string[];
  nameInputInPage: boolean;
  nameInputType: string;
}

test("【安全与备份恢复 / UI】 WL-UI-152：密钥注册提供身份验证器类型选择器+设备名称", async () => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await openPopup(ctx.context, ctx.extensionId);
    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });

    // The elements live inside the (hidden) passkey page; assert the DOM
    // contract directly rather than driving the full identity flow. The tester
    // tsconfig has no DOM lib, so reach document via globalThis in the
    // browser-context callback.
    const contract = await popup.evaluate<FormContract>(() => {
      const doc = (globalThis as { document?: any }).document;
      const page = doc?.getElementById('walletIdentityPasskeyPage');
      const typeSelect = doc?.getElementById('walletIdentityPasskeyTypeSelect');
      const nameInput = doc?.getElementById('walletIdentityPasskeyDeviceNameInput');
      return {
        typeSelectInPage: !!(page && typeSelect && page.contains(typeSelect)),
        typeOptionValues: typeSelect
          ? Array.from(typeSelect.querySelectorAll('option')).map((o: any) => o.value)
          : [],
        nameInputInPage: !!(page && nameInput && page.contains(nameInput)),
        nameInputType: nameInput?.type ?? '',
      };
    });

    // Authenticator-type selector present with exactly the two supported values.
    expect(contract.typeSelectInPage).toBe(true);
    expect(contract.typeOptionValues).toEqual(['platform', 'cross-platform']);
    // Custom device-name text input present.
    expect(contract.nameInputInPage).toBe(true);
    expect(contract.nameInputType).toBe('text');
  } finally {
    await teardownWalletContext(ctx);
  }
});
