/**
 * Wallet — popup: transfer recipient address validation (WL-UI-027).
 *
 * The transfer form validates `#recipientAddress` before doing anything
 * network-bound. Invalid input must be rejected with an error toast while
 * the user stays on `#transferPage` — no broadcast, no waiting overlay.
 *
 * What the wallet actually enforces (verified in
 * `js/controller/transaction/transaction-send-controller.js` →
 * `isValidAddress`): a strict `^0x[a-fA-F0-9]{40}$` *format* check. So:
 *
 *   - wrong length / non-hex chars  → rejected with 「地址格式无效」.
 *   - a well-formed address (incl. all-lowercase) → passes the address
 *     check and validation moves on to the amount.
 *
 * NB / doc discrepancy: WL-UI-027 also expects mixed-case addresses to be
 * EIP-55 checksum-validated. The transfer send path does NOT do that today
 * (`isValidAddress` is format-only; `isValidChecksum` exists in
 * `address-utils.js` but is not called here), so a mixed-case wrong-checksum
 * address would pass the form's address check. We therefore assert only the
 * behavior that actually runs: format rejection + well-formed acceptance.
 *
 * Hermetic: to prove the address passed validation without triggering a
 * network send, the acceptance case leaves `#amount` empty so validation
 * stops at 「请输入有效金额」 instead of broadcasting.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, createAndUnlockWallet } from '../helpers/popup';

const VALID_AMOUNT = '0.001';
// 40 hex chars but the wrong length (39) — fails the format regex.
const TOO_SHORT = '0x111111111111111111111111111111111111111';
// Correct length but contains non-hex characters (zzzz).
const NON_HEX = '0xzzzz111111111111111111111111111111111111';
// A well-formed, all-lowercase address (passes the format check).
const VALID_LOWERCASE = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

async function openTransferPage(context: import('@playwright/test').BrowserContext, extensionId: string) {
  const popup = await createAndUnlockWallet(context, extensionId);
  await byId(popup, 'transferBtn').click();
  await byId(popup, 'transferPage').waitFor({ state: 'visible' });
  return popup;
}

test(localizedTitle("【转账与交易 / UI】 转账会拒绝格式错误的收件人地址并停留在转账页面", "transfer rejects malformed recipient addresses and stays on the transfer page"), async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await openTransferPage(ctx.context, ctx.extensionId);

    // -- Case 1: wrong-length address -----------------------------------
    await byId(popup, 'recipientAddress').fill(TOO_SHORT);
    await byId(popup, 'amount').fill(VALID_AMOUNT);
    await byId(popup, 'sendBtn').click();
    await expect(byId(popup, 'globalToast')).toContainText('地址格式无效', { timeout: 10_000 });
    await expect(byId(popup, 'transferPage')).toBeVisible();
    // The send never started → no waiting overlay stuck on screen.
    await expect(byId(popup, 'globalWaitingOverlay')).toBeHidden();
    await recorder.step(popup, '长度错误的地址被拒绝', {
      note: '弹出「地址格式无效」toast,停留在转账页,未发起广播。',
    });

    // -- Case 2: correct length but non-hex characters ------------------
    await byId(popup, 'recipientAddress').fill(NON_HEX);
    await byId(popup, 'sendBtn').click();
    await expect(byId(popup, 'globalToast')).toContainText('地址格式无效', { timeout: 10_000 });
    await expect(byId(popup, 'transferPage')).toBeVisible();
  } finally {
    await teardownWalletContext(ctx);
  }
});

test(localizedTitle("【转账与交易 / UI】 转账接受格式正确的收件人地址（验证金额）", "transfer accepts a well-formed recipient address (validation advances to amount)"), async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await openTransferPage(ctx.context, ctx.extensionId);

    // Well-formed address + empty amount: the address check passes, so the
    // next validation error is about the amount — proving the address was
    // accepted without any network broadcast.
    await byId(popup, 'recipientAddress').fill(VALID_LOWERCASE);
    await byId(popup, 'amount').fill('');
    await byId(popup, 'sendBtn').click();

    await expect(byId(popup, 'globalToast')).toContainText('请输入有效金额', { timeout: 10_000 });
    // Crucially, it did NOT reject the address itself.
    await expect(byId(popup, 'globalToast')).not.toContainText('地址格式无效');
    await expect(byId(popup, 'transferPage')).toBeVisible();
    await recorder.step(popup, '合法地址通过校验', {
      note: '全小写合法地址被接受,校验推进到金额环节(此处金额为空)。',
    });
  } finally {
    await teardownWalletContext(ctx);
  }
});
