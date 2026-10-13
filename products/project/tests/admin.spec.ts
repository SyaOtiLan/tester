/**
 * project — team/member administration (P1 API).
 *
 * Covers PJ-126, PJ-127, PJ-128 — all admin-only endpoints.
 *
 * These require a site-admin session. The only admin account on this deployment
 * (PROJECT_ADMIN_EMAIL) is captcha-locked: DooTask arms a forever `code::<email>`
 * flag after any failed login and login then requires an OCR captcha we cannot
 * solve, and a fresh throwaway account is a normal user (users/lists → 权限不足).
 * There is no way to obtain an admin token here, so these are cleanly skipped.
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
import { test } from '../fixtures';
import { baseURLFor } from '../fixtures';

const baseURL = baseURLFor('project');

test.describe("【团队/会员管理(管理员)】项目管理员成员管理（P1 API）（project admin member management (P1 API)）", () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  const adminReason =
    'admin login is captcha-locked (PROJECT_ADMIN_EMAIL requires an OCR captcha; ' +
    'needcode=need). No usable admin session is obtainable in this environment.';

  // PJ-126 管理员获取会员列表
  test("【团队/会员管理(管理员) / API】 PJ-126 管理员获取会员列表", async () => {
    test.skip(true, adminReason);
  });

  // PJ-127 管理员创建用户
  test("【团队/会员管理(管理员) / API】 PJ-127 管理员创建用户", async () => {
    test.skip(true, adminReason);
  });

  // PJ-128 管理员批量导入预览/导入
  test("【团队/会员管理(管理员) / API】 PJ-128 管理员批量导入预览/导入", async () => {
    test.skip(true, adminReason);
  });
});
