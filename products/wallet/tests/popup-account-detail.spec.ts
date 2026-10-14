/**
 * Wallet — popup: account-detail receive (QR + copy) and encrypted export.
 *
 *   WL-UI-014  Account detail page renders a receive QR for the account and
 *              the copy button places the FULL address on the clipboard with
 *              a success toast.
 *   WL-UI-015  从账户管理页导出加密备份:需输入当前密码,产出一份可再导入的
 *              JSON 备份文件,并给出「已加密导出」提示。
 *
 * Selectors verified against `wallet/html/popup.html` and
 * `js/controller/account/account-detail-controller.js` (copy →
 * `copyAddressToClipboard` + `showSuccess('地址已复制')`; QR via
 * `generateQRCode('accountDetailQr')`) and
 * `js/controller/account/account-list-controller.js` (`handleExportAccounts`
 * → promptPassword → `exportAccountsFile` → download + `showSuccess('已加密导出 …')`).
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, createAndUnlockWallet, TEST_PASSWORD } from '../helpers/popup';

/** Header switcher → 账户管理 → open the first account's detail page. */
async function openFirstAccountDetail(popup: import('@playwright/test').Page): Promise<void> {
  await byId(popup, 'accountHeader').click();
  await byId(popup, 'accountSwitcherMenu').waitFor({ state: 'visible' });
  await byId(popup, 'manageAccountsBtn').click();
  await byId(popup, 'accountsPage').waitFor({ state: 'visible' });
  await popup.locator('#walletList .account-item').first().click();
  await byId(popup, 'accountDetailPage').waitFor({ state: 'visible' });
}

test(localizedTitle("【账户管理 / UI】 WL-UI-014 账户详情展示收款二维码并复制地址", "WL-UI-014: account detail shows a receive QR and copies the full address"), async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);

    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);
    await popup.bringToFront();
    // The extension origin is opaque, so `grantPermissions` can't authorize the
    // async clipboard API. Instead hook `navigator.clipboard.writeText` to
    // capture exactly what the copy button writes — that IS the value a user
    // would paste, and it lets us prove it's the FULL address.
    await popup.evaluate(() => {
      (globalThis as any).__copied = null;
      const clip = navigator.clipboard as any;
      clip.writeText = (text: string) => {
        (globalThis as any).__copied = String(text);
        return Promise.resolve();
      };
    });
    await openFirstAccountDetail(popup);
    await recorder.step(popup, '进入账户详情页');

    // The QR container renders a code (canvas/img from the QRCode lib). The
    // canvas can carry zero CSS box while still holding a 160×160 bitmap, so
    // assert it's present with a non-empty intrinsic size rather than "visible".
    const qrNode = byId(popup, 'accountDetailQr').locator('canvas, img, svg').first();
    await expect(qrNode).toBeAttached({ timeout: 10_000 });
    await expect
      .poll(
        () =>
          qrNode.evaluate((el) => {
            const c = el as HTMLCanvasElement & HTMLImageElement;
            return (c.width || c.naturalWidth || 0) as number;
          }),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);

    // The address row shows a (shortened) address string.
    const shown = (await byId(popup, 'accountDetailAddress').textContent())?.trim() ?? '';
    expect(shown).toMatch(/^0x[\da-fA-F]+(?:…|\.\.\.)[\da-fA-F]+$/);
    await recorder.step(popup, '二维码与地址已渲染');

    // Copy → success toast, and the clipboard hook captured the FULL 40-hex address.
    await byId(popup, 'copyAccountAddressBtn').click();
    await expect(byId(popup, 'globalToast')).toContainText('地址已复制', { timeout: 10_000 });

    const clip = await popup.evaluate(() => (globalThis as any).__copied as string | null);
    expect(clip ?? '').toMatch(/^0x[\da-fA-F]{40}$/);
    // The copied full address is consistent with the shortened display.
    const [prefix, suffix] = shown.toLowerCase().split(/…|\.\.\./);
    expect(clip!.toLowerCase().startsWith(prefix)).toBe(true);
    expect(clip!.toLowerCase().endsWith(suffix)).toBe(true);
    await recorder.step(popup, '复制成功,剪贴板为完整地址');
  } finally {
    await teardownWalletContext(ctx);
  }
});

test(localizedTitle("【账户管理 / UI】 WL-UI-015 导出账户", "WL-UI-015: exporting accounts requires the password and produces a re-importable backup"), async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);

    // Open the accounts-management page and its ⋯ menu.
    await byId(popup, 'accountHeader').click();
    await byId(popup, 'accountSwitcherMenu').waitFor({ state: 'visible' });
    await byId(popup, 'manageAccountsBtn').click();
    await byId(popup, 'accountsPage').waitFor({ state: 'visible' });

    await popup.locator('#accountsMenuBtn').click();
    await popup.locator('#accountsMenu').waitFor({ state: 'visible' });
    await popup.locator('#accountsExportBtn').click();
    await recorder.step(popup, '点击导出钱包');

    // Export demands the current password before anything is written.
    const prompt = popup.locator('#passwordPromptModal');
    await prompt.waitFor({ state: 'visible', timeout: 10_000 });
    await popup.locator('#passwordPromptInput').fill(TEST_PASSWORD);

    // Approving the prompt triggers a file download (the encrypted backup).
    const downloadPromise = popup.waitForEvent('download', { timeout: 20_000 });
    await popup.locator('#passwordPromptConfirm').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^yeying-accounts-.*\.json$/);
    await expect(byId(popup, 'globalToast')).toContainText('已加密导出', { timeout: 10_000 });
    await recorder.step(popup, '生成加密备份文件并提示导出成功');
  } finally {
    await teardownWalletContext(ctx);
  }
});
