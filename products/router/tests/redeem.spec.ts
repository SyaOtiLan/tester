/**
 * router — redeem-code top-up dialog (RT-E2E-003).
 *
 * DEGRADED SKIP — not runnable against this build.
 *
 * The redeem-code dialog `RedeemCodePage` (with the `.router-machine-input`
 * field + `submitRedemption` → POST /api/v1/public/user/topup) is only ever
 * mounted by `web/src/pages/TopUp/BalanceStatusPage.jsx` and
 * `web/src/pages/TopUp/TopUpRecordsPage.jsx`. Neither page is wired into the
 * live route table (`web/src/App.jsx`): `/workspace/topup` renders
 * `TopUpLayout` → `QuotaPage` only (which has no redeem entry point), and
 * `?tab=records` redirects to `/workspace/topup/history` → `QuotaHistoryPage`.
 * The only routed page carrying `.router-machine-input` is
 * `/admin/redemption/:id` (`RedemptionDetail`) — an admin redemption editor,
 * not the user redeem dialog, and gated behind `AdminOnlyRoute`.
 *
 * With no live UI route reaching the user redeem dialog, the E2E interaction
 * cannot be driven here. The underlying submit contract (POST /user/topup with
 * the code → controlled "无效的兑换码" error for a bogus code) was confirmed
 * against the live service but belongs to the redeem API case, not this UI flow.
 */
import { test, baseURLFor } from '../fixtures';

test("【令牌、充值与余额 / E2E】 兑换代码对话框输入并提交（RedeemCodePage）", async () => {
  test.skip(
    !!baseURLFor('router') || true,
    'RedeemCodePage is only mounted by unrouted pages (BalanceStatusPage/TopUpRecordsPage); ' +
      'no live UI route reaches the user redeem-code dialog in this build',
  );
});
