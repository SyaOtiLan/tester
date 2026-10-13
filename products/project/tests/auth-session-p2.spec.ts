/**
 * project — auth & session edge cases (P2 API).
 *
 * Covers PJ-009 (login captcha image), PJ-015 (token/expire refresh window),
 * PJ-022 (passport login-status polling).
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
import { test, expect, baseURLFor } from '../fixtures';
import { registerUser, apiGet, apiPost, type RegisteredUser } from '../helpers/api';

const baseURL = baseURLFor('project');

test.describe("【鉴权与会话守卫】项目授权和会话（P2 API）（project auth & session (P2 API)）", () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  let user: RegisteredUser;
  test.beforeAll(async () => {
    if (!baseURL) return;
    user = await registerUser(baseURL);
  });

  // PJ-009 codejson 返回图形验证码
  test("【鉴权与会话守卫 / API】 PJ-009 codejson 返回图形验证码", async () => {
    const body = await apiGet(baseURL!, '/api/users/login/codejson', user.token);
    expect(body.ret).toBe(1);
    // The captcha payload carries a base64 <img>, an opaque key echoed back on
    // login, and a "sensitive" flag telling the UI whether a captcha is required.
    expect(typeof body.data.img).toBe('string');
    expect(body.data.img.length).toBeGreaterThan(0);
    expect(typeof body.data.key).toBe('string');
    expect(body.data.key.length).toBeGreaterThan(0);
    expect(body.data).toHaveProperty('sensitive');
  });

  // PJ-015 token/expire refresh 临近过期时轮换
  test("【鉴权与会话守卫 / API】 PJ-015 token/expire refresh 临近过期时轮换", async () => {
    // A freshly registered token has its full validity window ahead of it, so
    // the endpoint reports it as far-from-expiry and does NOT rotate. (Actual
    // rotation only fires once the token enters the final third of its lifetime,
    // which cannot be forced without DB clock access — the no-rotation branch is
    // the deterministically reachable one and is what we assert here.)
    const body = await apiGet(baseURL!, '/api/users/token/expire', user.token);
    expect(body.ret).toBe(1);
    expect(body.data).toHaveProperty('expired_at');
    expect(body.data).toHaveProperty('server_time');
    expect(body.data.expired).toBe(false);
    expect(typeof body.data.remaining_seconds).toBe('number');
    expect(body.data.remaining_seconds).toBeGreaterThan(0);

    // The token is still valid after the check (it was not rotated / revoked).
    const still = await apiGet(baseURL!, '/api/users/info', user.token);
    expect(still.ret).toBe(1);
  });

  // PJ-022 passport 登录状态轮询
  test("【鉴权与会话守卫 / API】 PJ-022 passport 登录状态轮询", async () => {
    // An empty session id is rejected up-front.
    const empty = await apiPost(baseURL!, '/api/passport/login/status', {}, user.token);
    expect(empty.ret).toBe(0);
    expect(empty.msg).toBe('session_id 不能为空');

    // An unknown / stale session id polls as "expired" (a real approved/pending
    // status needs an out-of-band passport QR scan we cannot drive headlessly;
    // the expired branch is the deterministic outcome for a bogus id).
    const bogus = await apiPost(
      baseURL!,
      '/api/passport/login/status',
      { session_id: `bogus_${Date.now()}` },
      user.token,
    );
    expect(bogus.ret).toBe(0);
    expect(bogus.msg).toBe('通行证登录二维码已过期');
    expect(bogus.data.code).toBe('expired');
    expect(bogus.data.status).toBe('expired');
  });
});
