/**
 * warehouse — self-service password change (WH-API-062, 063, 064).
 *
 * POST /api/v1/public/webdav/user/password { oldPassword, newPassword }.
 *   - WH-API-062: a valid change succeeds (200). To avoid ever disturbing a
 *     shared credential (parallel specs log in as admin), this runs against a
 *     FRESH random wallet identity auto-created via SIWE: it has no password, so
 *     the first change needs no old password, and a second change then also
 *     covers the verified-old-password path. The account is disposable.
 *   - WH-API-063: a new password shorter than 6 chars is rejected with 400
 *     ("New password is invalid") and does NOT mutate the stored password.
 *   - WH-API-064: a wrong old password is rejected with 401 ("Old password is
 *     incorrect") and does NOT mutate the stored password. Runs against the
 *     admin JWT (a has-password account) — the wrong-old check only fires for
 *     accounts that already have a password — and never reaches the save path.
 *
 * Requires WAREHOUSE_USER + WAREHOUSE_PASS (the endpoint enforces the old
 * password only for accounts that already have one, which password-login
 * accounts do).
 *
 * Source: handler/user.go UpdatePassword — validates newPassword length first
 * (>=6 else 400), then verifies oldPassword for password accounts (401 on
 * mismatch), then saves and returns 200 {success:true}.
 */
import { test, expect, envFor } from '../fixtures';
import { loginWithPassword, loginWithWallet, authedRequest, getUserInfo } from '../helpers/auth';
import { apiContext } from '../../../shared/api';
import { Wallet } from 'ethers';

const PW_PATH = '/api/v1/public/webdav/user/password';
const LOGIN_PATH = '/api/v1/public/auth/password/login';

function apiBase(): string | undefined {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_URL'];
}
function creds(): { user?: string; pass?: string } {
  const env = envFor('warehouse');
  return { user: env['WAREHOUSE_USER'], pass: env['WAREHOUSE_PASS'] };
}
function hasPasswordCreds(): boolean {
  const { user, pass } = creds();
  return Boolean(user && pass);
}
function skipGuards() {
  test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
  test.skip(!hasPasswordCreds(), 'WAREHOUSE_USER/PASS required for password-change tests');
}

async function rawLoginStatus(username: string, password: string): Promise<number> {
  const anon = await apiContext(apiBase()!);
  try {
    const res = await anon.post(LOGIN_PATH, { data: { username, password } });
    return res.status();
  } finally {
    await anon.dispose();
  }
}

test.describe("【用户资料与密码】自助修改密码（self-service password change）", () => {
  test.describe.configure({ mode: 'serial' });

  test("【用户资料与密码 / API】 WH-API-062 修改密码成功", async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    // Operate on a FRESH random wallet identity (auto-created via SIWE) rather
    // than the shared admin credential: changing a throwaway account's password
    // exercises the success path for real without ever mutating a credential
    // that other specs log in with concurrently. A brand-new SIWE account has
    // no password, so the first change needs no old password; we then perform a
    // second change WITH the correct old password to also cover the verified
    // change path. The account is disposable, so no revert is required.
    const freshPk = Wallet.createRandom().privateKey;
    const tokens = await loginWithWallet(apiBase()!, freshPk);
    const ctx = await authedRequest(apiBase()!, tokens.token);
    try {
      // sanity: a fresh SIWE account starts without a password
      const info = await getUserInfo(apiBase()!, tokens.token);
      expect(info.hasPassword).toBe(false);

      const first = 'e2e_pw_first_123';
      const second = 'e2e_pw_second_456';

      // 1. set the initial password (no old password required)
      const set = await ctx.post(PW_PATH, { data: { newPassword: first } });
      expect(set.status()).toBe(200);

      // 2. change it again, this time verifying the correct old password
      const change = await ctx.post(PW_PATH, {
        data: { oldPassword: first, newPassword: second },
      });
      expect(change.status()).toBe(200);
    } finally {
      await ctx.dispose();
    }
  });

  test("【用户资料与密码 / API】 WH-API-063 新密码少于 6 位被拒", async () => {
    skipGuards();
    const { pass } = creds();
    const tokens = await loginWithPassword(apiBase()!);
    const ctx = await authedRequest(apiBase()!, tokens.token);
    try {
      const res = await ctx.post(PW_PATH, {
        data: { oldPassword: pass, newPassword: '12345' },
      });
      expect(res.status()).toBe(400);
      // The stored password is unchanged.
      expect(await rawLoginStatus(creds().user!, pass!)).toBe(200);
    } finally {
      await ctx.dispose();
    }
  });

  test("【用户资料与密码 / API】 WH-API-064 旧密码错误被拒", async () => {
    skipGuards();
    const { user, pass } = creds();
    const tokens = await loginWithPassword(apiBase()!);
    const ctx = await authedRequest(apiBase()!, tokens.token);
    try {
      const res = await ctx.post(PW_PATH, {
        data: { oldPassword: 'definitely-not-the-password', newPassword: 'valid_enough' },
      });
      expect(res.status()).toBe(401);
      // The stored password is unchanged.
      expect(await rawLoginStatus(user!, pass!)).toBe(200);
    } finally {
      await ctx.dispose();
    }
  });
});
