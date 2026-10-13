/**
 * Wallet — popup smoke: transfer-form state persists across popup
 * close + reopen.
 *
 * Mirrors the transfer section of
 * `wallet/tests/e2e/extension-smoke.test.mjs` test 1, which was deleted
 * when e2e moved to tester. The flow:
 *
 *   1. Create + unlock a wallet.
 *   2. Open the transfer screen via `#transferBtn`.
 *   3. Fill `#recipientAddress` and `#amount`.
 *   4. Close the popup *page* (NOT the context — the extension's
 *      chrome.storage must survive).
 *   5. Open a fresh popup page. `#transferPage` should re-render with
 *      the same recipient + amount, and the unlock input must be empty
 *      (proving the page wasn't a leftover DOM snapshot).
 *   6. Hit the back button → returns to `#walletPage`.
 *
 * Why this matters: a user who starts typing a transfer, accidentally
 * closes the popup, and reopens it should not lose their input. The
 * wallet persists the in-progress transfer to chrome.storage.session.
 */
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, createAndUnlockWallet, openPopup } from '../helpers/popup';

const RECIPIENT = '0x1111111111111111111111111111111111111111';
const AMOUNT = '1.25';

test("【转账与交易 / UI】 转账表单在弹出窗口关闭+重新打开后仍然有效", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);

    // -- Step 1: create + unlock a fresh wallet -------------------------
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);

    // -- Step 2: enter the transfer screen ------------------------------
    await byId(popup, 'transferBtn').click();
    await byId(popup, 'transferPage').waitFor({ state: 'visible' });
    await recorder.step(popup, '转账页（空表）', {
      note: '从主页点"转账"按钮进入。第一次打开时字段为空。',
    });

    // -- Step 3: fill the form ------------------------------------------
    await byId(popup, 'recipientAddress').fill(RECIPIENT);
    await byId(popup, 'amount').fill(AMOUNT);
    await recorder.step(popup, '填好金额与收款地址', {
      note: '输入未确认；用户此时可能关闭弹窗去看地址簿。',
    });

    // -- Step 4: close the popup page (NOT the context) -----------------
    await popup.close();

    // -- Step 5: reopen — transfer state should be restored -------------
    const reopened = await openPopup(ctx.context, ctx.extensionId);
    await byId(reopened, 'transferPage').waitFor({ state: 'visible', timeout: 5_000 });
    await recorder.step(reopened, '重新打开弹窗 → 自动回到转账页', {
      note: '字段值应该还在；如果回到主页或字段清空，说明持久化没工作。',
    });

    await expect(byId(reopened, 'recipientAddress')).toHaveValue(RECIPIENT);
    await expect(byId(reopened, 'amount')).toHaveValue(AMOUNT);
    // The unlock page must NOT be present — that would mean the wallet
    // re-locked itself in between, which would be a separate bug.
    await expect(byId(reopened, 'unlockPassword')).toHaveValue('');

    // -- Step 6: back button returns to the wallet page -----------------
    await reopened.locator('#transferPage .back-btn').click();
    await byId(reopened, 'walletPage').waitFor({ state: 'visible' });
  } finally {
    await teardownWalletContext(ctx);
  }
});