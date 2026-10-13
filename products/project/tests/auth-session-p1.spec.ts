/**
 * project — authentication & session (P1).
 *
 * Covers PJ-007, PJ-008, PJ-010, PJ-011(skip), PJ-014, PJ-016, PJ-017(UI),
 * PJ-018, PJ-019, PJ-020, PJ-021.
 *
 * Auth strategy mirrors the P0 auth spec: throwaway accounts registered over the
 * open registration path yield a usable, non-captcha-locked token immediately.
 * Wallet SIWE cases drive the real challenge/verify endpoints and sign with
 * ethers; they only assert the challenge/verify *shapes* (a first wallet login
 * intentionally stops at the email-setup gate, which is the documented contract).
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
import { request } from '@playwright/test';
import { Wallet } from 'ethers';
import { test, expect, baseURLFor } from '../fixtures';
import { registerUser, loginPassword, apiGet, apiPost } from '../helpers/api';
import { uiLogin } from '../helpers/session';

const baseURL = baseURLFor('project');

// Registration and first-time wallet verify both insert into the shared
// notification dialog, which can trip a MySQL deadlock when many accounts are
// created concurrently across workers. Retry those raw calls on that transient.
const isDeadlock = (msg?: string) => /deadlock|serialization/i.test(msg ?? '');
async function retryOnDeadlock<T extends { ret: number; msg: string }>(fn: () => Promise<T>): Promise<T> {
  let body = await fn();
  for (let attempt = 0; attempt < 15 && body.ret !== 1 && isDeadlock(body.msg); attempt++) {
    await new Promise((r) => setTimeout(r, 120 + Math.floor(Math.random() * 380)));
    body = await fn();
  }
  return body;
}

test.describe("【鉴权与会话守卫】项目认证与会话（P1 API）（project auth & session (P1 API)）", () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  // PJ-007 账号/密码超 32 位被拒
  test("【鉴权与会话守卫 / API】 PJ-007 账号/密码超 32 位被拒", async () => {
    const longPass = 'x'.repeat(33);
    const body = await loginPassword(baseURL!, 'someone@e2e.local', longPass);
    expect(body.ret).toBe(0);
    // login path returns the generic credential error for over-length input.
    expect(body.msg).toBe('帐号或密码错误');

    // The registration path reports the length limit explicitly.
    const reg = await apiPost(baseURL!, '/api/users/login', {
      type: 'reg',
      email: 'a'.repeat(30) + '@e2e.local',
      password: 'y'.repeat(33),
    });
    expect(reg.ret).toBe(0);
    expect(reg.msg).toBe('账号密码最多可输入32位字符');
  });

  // PJ-008 login/needcode 反映验证码要求
  test("【鉴权与会话守卫 / API】 PJ-008 login/needcode 反映验证码要求", async () => {
    const user = await registerUser(baseURL!);
    // A fresh, never-failed email needs no captcha.
    const before = await apiGet(baseURL!, `/api/users/login/needcode?email=${encodeURIComponent(user.email)}`);
    expect(before.ret).toBe(0);
    expect(before.msg).toBe('no');

    // A failed login arms the captcha flag for that email.
    await loginPassword(baseURL!, user.email, 'definitely-wrong');
    const after = await apiGet(baseURL!, `/api/users/login/needcode?email=${encodeURIComponent(user.email)}`);
    expect(after.ret).toBe(1);
    expect(after.msg).toBe('need');
  });

  // PJ-010 注册(type=reg)创建账号
  test("【鉴权与会话守卫 / API】 PJ-010 注册(type=reg)创建账号", async () => {
    // On this deployment email verification is off, so reg directly signs a token.
    // A deadlock can fire *after* the user row is committed, so each retry must
    // use a fresh email (a reused one would then hit 邮箱地址已存在).
    const body = await retryOnDeadlock(() => {
      const uniq = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 16);
      const email = `e2e_${uniq}@e2e.local`;
      return apiPost(baseURL!, '/api/users/login', { type: 'reg', email, password: 'Test123456' });
    });
    expect(body.ret, `reg failed: ${body.msg}`).toBe(1);
    expect(body.msg).toBe('注册成功');
    expect(typeof body.data.token).toBe('string');
    expect(body.data.token.length).toBeGreaterThan(0);
    expect(Number(body.data.userid)).toBeGreaterThan(0);
  });

  // PJ-011 注册关闭/需邀请码校验
  test("【鉴权与会话守卫 / API】 PJ-011 注册关闭/需邀请码校验", async () => {
    test.skip(
      true,
      'registration mode is a server-side DB setting (system.reg=open here), not a client param — ' +
        'switching to reg=close / reg=invite requires admin reconfiguration which is not available',
    );
  });

  // PJ-014 token/expire 查询过期时间
  test("【鉴权与会话守卫 / API】 PJ-014 token/expire 查询过期时间", async () => {
    const user = await registerUser(baseURL!);
    const body = await apiGet(baseURL!, '/api/users/token/expire', user.token);
    expect(body.ret).toBe(1);
    for (const key of ['expired_at', 'remaining_seconds', 'expired', 'server_time']) {
      expect(body.data, `token/expire missing ${key}`).toHaveProperty(key);
    }
    expect(body.data.expired).toBe(false);
    expect(Number(body.data.remaining_seconds)).toBeGreaterThan(0);
  });

  // PJ-016 logout 退出登录使会话失效
  test("【鉴权与会话守卫 / API】 PJ-016 logout 退出登录使会话失效", async () => {
    const user = await registerUser(baseURL!);
    const out = await apiGet(baseURL!, '/api/users/logout', user.token);
    expect(out.ret).toBe(1);
    expect(out.msg).toBe('退出成功');

    const after = await apiGet(baseURL!, '/api/users/info', user.token);
    expect(after.ret).toBe(-1);
  });

  // PJ-018 钱包 SIWE challenge 返回挑战与 nonce
  test("【鉴权与会话守卫 / API】 PJ-018 钱包 SIWE challenge 返回挑战与 nonce", async () => {
    const wallet = Wallet.createRandom();
    const ok = await apiPost(baseURL!, '/api/public/auth/challenge', {
      address: wallet.address,
      chain_id: '1',
    });
    expect(ok.ret).toBe(1);
    for (const key of ['challenge', 'nonce', 'expires_at']) {
      expect(ok.data, `challenge missing ${key}`).toHaveProperty(key);
    }
    expect(typeof ok.data.challenge).toBe('string');
    // The server echoes the address lower-cased in the SIWE message.
    expect(ok.data.challenge.toLowerCase()).toContain(wallet.address.toLowerCase());

    // An invalid address is rejected with HTTP 422.
    const ctx = await request.newContext({ baseURL: baseURL! });
    try {
      const res = await ctx.post('/api/public/auth/challenge', {
        headers: { 'Content-Type': 'application/json' },
        data: { address: '0xbad' },
      });
      expect(res.status()).toBe(422);
    } finally {
      await ctx.dispose();
    }
  });

  // PJ-019 钱包 SIWE verify 签名不匹配被拒
  test("【鉴权与会话守卫 / API】 PJ-019 钱包 SIWE verify 签名不匹配被拒", async () => {
    const claimed = Wallet.createRandom();
    const other = Wallet.createRandom();
    const ch = await apiPost(baseURL!, '/api/public/auth/challenge', { address: claimed.address, chain_id: '1' });
    expect(ch.ret).toBe(1);
    // Sign the challenge with a DIFFERENT key so the recovered address mismatches.
    const signature = await other.signMessage(ch.data.challenge);
    const verify = await apiPost(baseURL!, '/api/public/auth/verify', {
      address: claimed.address,
      chain_id: '1',
      signature,
    });
    expect(verify.ret).toBe(0);
    expect(verify.data.code).toBe('wallet_signature_mismatch');
  });

  // PJ-020 首次钱包登录要求补全邮箱
  test("【鉴权与会话守卫 / API】 PJ-020 首次钱包登录要求补全邮箱", async () => {
    const verify = await retryOnDeadlock(async () => {
      const wallet = Wallet.createRandom();
      const ch = await apiPost(baseURL!, '/api/public/auth/challenge', { address: wallet.address, chain_id: '1' });
      expect(ch.ret).toBe(1);
      const signature = await wallet.signMessage(ch.data.challenge);
      return apiPost(baseURL!, '/api/public/auth/verify', {
        address: wallet.address,
        chain_id: '1',
        signature,
      });
    });
    // A brand-new wallet is valid but has no email yet -> setup gate.
    expect(verify.ret).toBe(0);
    expect(verify.data.code).toBe('wallet_email_required');
    expect(typeof verify.data.setup_token).toBe('string');
    expect(verify.data.setup_token.length).toBeGreaterThan(0);
  });

  // PJ-021 passport 登录会话创建
  test("【鉴权与会话守卫 / API】 PJ-021 passport 登录会话创建(未配置降级)", async () => {
    const user = await registerUser(baseURL!);
    const body = await apiPost(baseURL!, '/api/passport/login/session', {}, user.token);
    if (body.ret === 0 && body.data?.code === 'passport_not_configured') {
      // Documented degraded contract when the passport Node service is unset.
      expect(body.msg).toBe('通行证登录未配置');
      return;
    }
    // Configured on this deployment: a pending session with a qrcode is issued.
    expect(body.ret).toBe(1);
    expect(body.data).toHaveProperty('session_id');
    expect(body.data).toHaveProperty('qrcode_url');
    expect(body.data.status).toBe('pending');
  });
});

test.describe("【鉴权与会话守卫】项目认证界面（P1 UI）（project auth (P1 UI)）", () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  // PJ-017 登录页切换到注册显示确认密码
  test("【鉴权与会话守卫 / UI】 PJ-017 登录页切换到注册显示确认密码/邀请码", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        (globalThis as any).localStorage.setItem('__system:languageName__', 'zh');
      } catch {
        /* ignore */
      }
    });
    await page.goto('/?language=zh', { waitUntil: 'domcontentloaded' });

    // Reveal the email/password panel, then switch it to register mode.
    const toggle = page.locator('.email-login-toggle');
    await toggle.first().waitFor({ state: 'visible', timeout: 15_000 });
    await toggle.first().click();

    const passwordCountBefore = await page.locator('input[type="password"]').count();

    const regLink = page.getByText('注册帐号', { exact: false }).first();
    await regLink.waitFor({ state: 'visible', timeout: 10_000 });
    await regLink.click();

    // Register mode adds a second password (confirm) input.
    await expect
      .poll(async () => page.locator('input[type="password"]').count(), { timeout: 10_000 })
      .toBeGreaterThan(passwordCountBefore);
  });
});
