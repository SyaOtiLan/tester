/**
 * project — authentication & session guard (API).
 *
 * Covers PJ-005, PJ-006, PJ-012, PJ-013, PJ-112, PJ-130, PJ-136.
 *
 * Auth strategy: the shared admin account (PROJECT_ADMIN_EMAIL) is
 * captcha-locked on this deployment, so every case here uses a freshly
 * registered throwaway account (registration is open + email verification off),
 * which yields a usable token immediately and is NOT captcha-locked.
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL   live service base URL (e.g. http://localhost:2222)
 */
import { request } from '@playwright/test';
import { test, expect, baseURLFor } from '../fixtures';
import { registerUser, loginPassword, apiGet, apiPost } from '../helpers/api';

const baseURL = baseURLFor('project');

test.describe("【鉴权与会话守卫】项目认证与会话守卫（API）（project auth & session guard (API)）", () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  // PJ-005 邮箱+密码登录成功签发 token
  test("【鉴权与会话守卫 / API】 PJ-005 邮箱+密码登录成功签发 token", async () => {
    const user = await registerUser(baseURL!);
    const body = await loginPassword(baseURL!, user.email, user.password);
    expect(body.ret).toBe(1);
    expect(body.msg).toBe('登录成功');
    expect(typeof body.data.token).toBe('string');
    expect(body.data.token.length).toBeGreaterThan(0);
    // Sensitive fields are never echoed back.
    expect('password' in body.data).toBe(false);
    expect('encrypt' in body.data).toBe(false);
  });

  // PJ-006 错误密码登录被拒且触发验证码
  test("【鉴权与会话守卫 / API】 PJ-006 错误密码登录被拒且触发验证码", async () => {
    const user = await registerUser(baseURL!);
    // Fresh account: needcode is initially "no" (ret=0).
    const before = await apiPost(baseURL!, '/api/users/login/needcode', { email: user.email });
    expect(before.ret).toBe(0);

    const wrong = await loginPassword(baseURL!, user.email, 'definitely-wrong-pass');
    expect(wrong.ret).toBe(0);
    expect(wrong.msg).toBe('帐号或密码错误');
    expect(wrong.data.code).toBe('need');

    // After a failed login the captcha flag is set: needcode now returns ret=1.
    const after = await apiPost(baseURL!, '/api/users/login/needcode', { email: user.email });
    expect(after.ret).toBe(1);
    expect(after.msg).toBe('need');
  });

  // PJ-012 未带 token 访问受保护接口返回 ret=-1
  test("【鉴权与会话守卫 / API】 PJ-012 未带 token 访问受保护接口返回 ret=-1", async () => {
    const res = await apiGet(baseURL!, '/api/users/info');
    expect(res.ret).toBe(-1);
    expect(res.msg).toBe('请登录后继续...');
  });

  // PJ-013 非法/过期 token 访问返回身份失效
  test("【鉴权与会话守卫 / API】 PJ-013 非法/过期 token 访问返回身份失效", async () => {
    const res = await apiGet(baseURL!, '/api/users/info', 'forged-token-xxxxx');
    expect(res.ret).toBe(-1);
    expect(res.msg).toBe('身份已失效,请重新登录');
  });

  // PJ-112 获取当前用户信息
  test("【个人设置与账号安全 / API】 PJ-112 获取当前用户信息", async () => {
    const user = await registerUser(baseURL!);
    const res = await apiGet(baseURL!, '/api/users/info', user.token);
    expect(res.ret).toBe(1);
    expect(Number(res.data.userid)).toBe(user.userid);
    expect(res.data.email).toBe(user.email);
    expect(res.data).toHaveProperty('nickname');
    expect(res.data).toHaveProperty('department');
  });

  // PJ-130 非管理员访问管理员接口被拒
  test("【团队/会员管理(管理员) / API】 PJ-130 非管理员访问管理员接口被拒", async () => {
    const user = await registerUser(baseURL!);
    const res = await apiGet(baseURL!, '/api/users/lists', user.token);
    expect(res.ret).toBe(0);
    // Real contract: msg is "权限不足" (doc only said "权限校验拦截").
    expect(res.msg).toContain('权限不足');
  });

  // PJ-136 获取系统版本号
  test("【系统、健康与错误异常 / API】 PJ-136 获取系统版本号", async () => {
    // NOTE contract discrepancy: unlike most endpoints, api/system/version does
    // NOT return the {ret,msg,data} envelope — it returns a raw object
    // { device_count, version, publish{...} }. We assert the real behaviour.
    const ctx = await request.newContext({ baseURL: baseURL! });
    try {
      const res = await ctx.get('/api/system/version');
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { version?: string };
      expect(typeof body.version).toBe('string');
      expect(body.version!.length).toBeGreaterThan(0);
    } finally {
      await ctx.dispose();
    }
  });
});
