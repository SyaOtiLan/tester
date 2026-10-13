/**
 * node — admin audit workflow (ND-E2E-003 / ND-E2E-004).
 *
 * These two cases require an ADMIN approver: publishing an application is
 * gated on an *approved* audit (node `hasApprovedAudit`), and approval only
 * happens through `/api/v1/admin/audits/:uid/approve`, which is restricted to
 * admin principals (vault `ADMIN_DIDS` / `USER_ROLE_OWNER`).
 *
 * In this environment no admin credential is available: the configured wallet
 * reports `isAdmin: false` and every `/api/v1/admin/*` route returns 403, and
 * a throwaway wallet is provisioned as a plain USER_ROLE_NORMAL. There is
 * therefore no way to drive an audit to "approved" and exercise the positive
 * publish path without fabricating a green result.
 *
 * Per the test plan these are skipped cleanly rather than faked. The inverse
 * boundary — an un-approved application cannot be published (403 "Audit not
 * approved") — IS covered and runnable in `app-write-api.spec.ts` (ND-API-022).
 */
import { test } from '../fixtures';

const NO_ADMIN_REASON =
  'requires an admin approver (ADMIN_DIDS / USER_ROLE_OWNER); none available in this ' +
  'environment. Inverse boundary covered by ND-API-022 in app-write-api.spec.ts.';

test("【开发者应用生命周期 / E2E】 ND-E2E-003 审核通过后发布并出现在市场", async () => {
  test.skip(true, NO_ADMIN_REASON);
});

test("【应用审核 / E2E】 ND-E2E-004 管理员审核:提交 → 审批通过 → 可发布", async () => {
  test.skip(true, NO_ADMIN_REASON);
});
