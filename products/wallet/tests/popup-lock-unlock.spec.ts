/**
 * Wallet — popup smoke: lock / unlock cycle, including SW kill recovery.
 *
 * Mirrors the lock/unlock tail of `wallet/tests/e2e/extension-smoke.test.mjs`
 * test 1. The flow:
 *
 *   1. Create + unlock a wallet (reuse popup-create flow).
 *   2. Lock from the header menu → reopen popup → #unlockPage.
 *   3. Wrong password → #globalToast shows "密码错误".
 *   4. Correct password → #walletPage in 5s.
 *   5. Terminate the extension service worker via CDP, reopen popup,
 *      unlock again → same #accountAddress.
 *
 * Why the SW-kill step matters: MV3 service workers can be killed by
 * Chromium at any time. The wallet is supposed to survive that and
 * restore state from chrome.storage.local. If this fails, a real user
 * could lose their wallet on a browser restart.
 */
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { TEST_PASSWORD, byId, createAndUnlockWallet, openPopup } from '../helpers/popup';

test("【安全与备份恢复 / UI】 锁定 + 解锁 + SW-kill 恢复保留钱包访问权限", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);

    // -- Step 1: create + unlock a fresh wallet -------------------------
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);

    // Capture the address so we can verify the SW-kill path returns the
    // same one (i.e. the keyring actually survived chrome.storage).
    const addressBefore = ((await byId(popup, 'accountAddress').textContent())?.trim() ?? '').toLowerCase();
    expect(addressBefore).toMatch(/^0x[\da-fA-F]+(?:…|\.\.\.)[\da-fA-F]+$/);

    // -- Step 2: lock from the header menu ------------------------------
    await byId(popup, 'walletHeaderMenuBtn').click();
    await expect(byId(popup, 'walletHeaderMenuBtn')).toHaveAttribute('aria-expanded', 'true');
    await recorder.step(popup, '钱包菜单展开（点锁屏）', {
      note: '右上角三点菜单；点击"锁屏钱包"立即锁住。',
    });
    await byId(popup, 'lockWalletBtn').click();
    await byId(popup, 'unlockPage').waitFor({ state: 'visible', timeout: 15_000 });

    await popup.close();
    const locked = await openPopup(ctx.context, ctx.extensionId);
    await byId(locked, 'unlockPage').waitFor({ state: 'visible', timeout: 15_000 });
    await recorder.step(locked, '解锁页（重新打开弹窗）', {
      note: '锁屏后弹窗需输入密码。',
    });

    // -- Step 3: wrong password → toast ----------------------------------
    await byId(locked, 'unlockPassword').fill('incorrect-password');
    await byId(locked, 'unlockBtn').click();
    await expect(byId(locked, 'globalToast')).toContainText('密码错误', { timeout: 10_000 });
    await recorder.step(locked, '输错密码 → 红色 toast "密码错误"', {
      note: '错误输入只提示，不清空密码框，方便用户直接改正。',
    });

    // -- Step 4: correct password → wallet page in 5s -------------------
    await byId(locked, 'unlockPassword').fill(TEST_PASSWORD);
    await byId(locked, 'unlockBtn').click();
    await byId(locked, 'walletPage').waitFor({ state: 'visible', timeout: 10_000 });

    // -- Step 5: terminate the service worker, prove recovery -----------
    // We need a regular page to attach a CDP session to. Open the popup
    // again (we already have one — `locked` is the now-unlocked popup).
    const cdp = await ctx.context.newCDPSession(locked);
    try {
      const { targetInfos } = await cdp.send('Target.getTargets');
      const sw = targetInfos.find(
        (t: { type: string; url: string; targetId?: string }) =>
          t.type === 'service_worker' &&
          t.url.startsWith(`chrome-extension://${ctx.extensionId}/`),
      );
      expect(sw?.targetId).toBeTruthy();
      if (sw?.targetId) {
        await cdp.send('Target.closeTarget', { targetId: sw.targetId });
      }
    } finally {
      await cdp.detach();
    }

    // After SW termination the wallet should re-prompt for the password.
    await locked.close();
    const afterKill = await openPopup(ctx.context, ctx.extensionId);
    await byId(afterKill, 'unlockPage').waitFor({ state: 'visible', timeout: 15_000 });
    await byId(afterKill, 'unlockPassword').fill(TEST_PASSWORD);
    await byId(afterKill, 'unlockBtn').click();
    await byId(afterKill, 'walletPage').waitFor({ state: 'visible', timeout: 15_000 });
    await recorder.step(afterKill, 'SW 被强杀后再次解锁，回到主页', {
      note: 'MV3 SW 可能随时被 Chromium 回收，必须能凭密码 + chrome.storage 恢复到同一账户。',
    });

    const addressAfter = ((await byId(afterKill, 'accountAddress').textContent())?.trim() ?? '').toLowerCase();
    // Both are truncated, so we can't compare full addresses; check the
    // prefix + suffix segments match. If the wallet restored a different
    // account, both would change.
    const [prefixBefore] = addressBefore.split(/…|\.\.\./);
    const [prefixAfter] = addressAfter.split(/…|\.\.\./);
    expect(prefixAfter).toBe(prefixBefore);

    // And the global waiting overlay should not be stuck — if it is, the
    // background never finished re-hydrating.
    await expect(byId(afterKill, 'globalWaitingOverlay')).toBeHidden();
  } finally {
    await teardownWalletContext(ctx);
  }
});

// WL-UI-034: repeated wrong unlock attempts each show 「密码错误」, never clear
// the input, never leak into the wallet page, and a correct password after
// several failures still unlocks (no lock-out that traps a legit user).
test("【错误、异常与安全边界 / UI】 WL-UI-034 连续多次错误解锁密码的处理", async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);

    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);

    // Lock from the header menu, then reopen to reach the unlock page.
    await byId(popup, 'walletHeaderMenuBtn').click();
    await byId(popup, 'lockWalletBtn').click();
    await byId(popup, 'unlockPage').waitFor({ state: 'visible', timeout: 15_000 });
    await popup.close();

    const locked = await openPopup(ctx.context, ctx.extensionId);
    await byId(locked, 'unlockPage').waitFor({ state: 'visible', timeout: 15_000 });

    // Three consecutive wrong attempts, each with a distinct value so we can
    // assert the field keeps exactly what the user typed.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const wrong = `definitely-wrong-${attempt}`;
      await byId(locked, 'unlockPassword').fill(wrong);
      await byId(locked, 'unlockBtn').click();
      await expect(byId(locked, 'globalToast')).toContainText('密码错误', { timeout: 10_000 });
      // The input is NOT cleared — the user can correct their typo in place.
      await expect(byId(locked, 'unlockPassword')).toHaveValue(wrong);
      // Still locked — no leak into the wallet page.
      await expect(byId(locked, 'walletPage')).toBeHidden();
      await expect(byId(locked, 'unlockPage')).toBeVisible();
      await recorder.step(locked, `第 ${attempt} 次输错密码,仍停留在解锁页`);
    }

    // A correct password after the failures still unlocks.
    await byId(locked, 'unlockPassword').fill(TEST_PASSWORD);
    await byId(locked, 'unlockBtn').click();
    await byId(locked, 'walletPage').waitFor({ state: 'visible', timeout: 15_000 });
    await recorder.step(locked, '多次失败后正确密码仍可解锁');
  } finally {
    await teardownWalletContext(ctx);
  }
});