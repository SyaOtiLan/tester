/**
 * social — platform auth API (login / register / guard).
 *
 * Covers the email+password auth path and the AuthInterceptor guard on the
 * Spring Boot platform backend (8888). All assertions are against live
 * behaviour verified while authoring these tests.
 *
 * Env:
 *  - SOCIAL_BASE_URL      platform backend (8888). Tests skip when unset.
 *  - SOCIAL_IDENTITY_URL  web3-identity (8901) — used only by SO-API-024 to
 *                         mint a real token via SIWE for /user/self.
 *
 * Contract (live):
 *  - Business envelope: {code, message, data}; success is code === 200.
 *  - Wrong password    -> HTTP 200, {code:10001,"密码不正确"}.
 *  - Protected routes authenticate via custom header `accessToken: <jwt>`.
 *      · missing header      -> {code:400,"未登录"} (NO_LOGIN)
 *      · well-formed but tampered JWT -> {code:401,"token无效或已过期"} (INVALID_TOKEN)
 *      · malformed garbage token      -> {code:500,"系统繁忙"} (parse error)
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';
import {
  registerAndLogin,
  randomEmailCreds,
  siweLogin,
  platformCtx,
  type Envelope,
  type LoginVO,
} from '../helpers/auth';
import { Wallet } from 'ethers';

const platformURL = () => baseURLFor('social');
const identityURL = () => envFor('social')['SOCIAL_IDENTITY_URL'];

function skipIfNoPlatform() {
  test.skip(!platformURL(), 'SOCIAL_BASE_URL not configured');
}

// SO-API-001 — email+password login yields a JWT envelope.
test(localizedTitle("【登录与注册 / API】 SO-API-001 邮箱+密码登录成功换取 JWT", "SO-API-001 email+password login returns LoginVO"), async () => {
  skipIfNoPlatform();
  const { login } = await registerAndLogin(platformURL()!);
  expect(login.code).toBe(200);
  expect(typeof login.data.accessToken).toBe('string');
  expect(login.data.accessToken.length).toBeGreaterThan(20);
  expect(typeof login.data.refreshToken).toBe('string');
  expect(login.data.accessTokenExpiresIn).toBeGreaterThan(0);
  expect(login.data.refreshTokenExpiresIn).toBeGreaterThan(0);
});

// SO-API-002 — wrong password is rejected, no token issued.
test(localizedTitle("【登录与注册 / API】 SO-API-002 错误密码登录被拒", "SO-API-002 wrong password is rejected"), async () => {
  skipIfNoPlatform();
  const { creds } = await registerAndLogin(platformURL()!);
  const ctx = await apiContext(platformURL()!);
  try {
    const res = await ctx.post('/login', {
      data: { email: creds.email, password: creds.password + '_wrong', terminal: 0 },
    });
    const body = (await res.json()) as Envelope<LoginVO | null>;
    expect(body.code).not.toBe(200);
    expect(body.data).toBeFalsy();
  } finally {
    await ctx.dispose();
  }
});

// SO-API-003 (P1) — unregistered email is rejected.
test(localizedTitle("【登录与注册 / API】 SO-API-003 未注册邮箱登录被拒", "SO-API-003 unknown email login is rejected"), async () => {
  skipIfNoPlatform();
  const ctx = await apiContext(platformURL()!);
  try {
    const email = `nobody_${Date.now()}@test.com`;
    const res = await ctx.post('/login', {
      data: { email, password: 'whatever123', terminal: 0 },
    });
    const body = (await res.json()) as Envelope<LoginVO | null>;
    expect(body.code).not.toBe(200);
    expect(body.data).toBeFalsy();
  } finally {
    await ctx.dispose();
  }
});

// SO-API-004 — register a new user, then log in with it.
test(localizedTitle("【登录与注册 / API】 SO-API-004 注册新用户", "SO-API-004 register new user then login"), async () => {
  skipIfNoPlatform();
  const creds = randomEmailCreds();
  const { register, login } = await registerAndLogin(platformURL()!, creds);
  expect(register.code).toBe(200);
  expect(login.code).toBe(200);
  expect(login.data.accessToken.length).toBeGreaterThan(20);
});

// SO-API-011 — protected route without accessToken header is rejected.
test(localizedTitle("【鉴权与会话守卫 / API】 SO-API-011 受保护接口缺 accessToken 头被拒", "SO-API-011 protected route without accessToken is rejected"), async () => {
  skipIfNoPlatform();
  const ctx = await apiContext(platformURL()!);
  try {
    const res = await ctx.get('/user/self');
    const body = (await res.json()) as Envelope<unknown>;
    expect(body.code).not.toBe(200); // NO_LOGIN (400)
    expect(body.code).toBe(400);
    expect(body.data).toBeFalsy();
  } finally {
    await ctx.dispose();
  }
});

// SO-API-012 — tampered (well-formed) accessToken is rejected as INVALID_TOKEN.
test(localizedTitle("【鉴权与会话守卫 / API】 SO-API-012 非法/篡改 accessToken 被拒", "SO-API-012 tampered accessToken is rejected"), async () => {
  skipIfNoPlatform();
  test.skip(!identityURL(), 'SOCIAL_IDENTITY_URL not configured');
  // Mint a real JWT, then flip one char of its signature segment so the
  // payload still parses but the HMAC check fails -> INVALID_TOKEN (401).
  const wallet = Wallet.createRandom();
  const { envelope } = await siweLogin(identityURL()!, wallet.privateKey);
  expect(envelope.code).toBe(200);
  const parts = envelope.data.accessToken.split('.');
  const s = parts[2] ?? '';
  const flipped = s.slice(0, -1) + (s.slice(-1) === 'A' ? 'B' : 'A');
  const tampered = `${parts[0]}.${parts[1]}.${flipped}`;

  const ctx = await platformCtx(platformURL()!, tampered);
  try {
    const res = await ctx.get('/user/self');
    const body = (await res.json()) as Envelope<unknown>;
    expect(body.code).toBe(401); // INVALID_TOKEN
    expect(body.data).toBeFalsy();
  } finally {
    await ctx.dispose();
  }
});

// SO-API-005 (P1) — registering an already-used email is rejected (no dup account).
test(localizedTitle("【登录与注册 / API】 SO-API-005 重复邮箱注册被拒", "SO-API-005 duplicate email register is rejected"), async () => {
  skipIfNoPlatform();
  const creds = randomEmailCreds();
  const first = await registerAndLogin(platformURL()!, creds);
  expect(first.register.code).toBe(200);
  // Re-register the SAME email that first succeeded with.
  const ctx = await apiContext(platformURL()!);
  try {
    const res = await ctx.post('/register', {
      data: { email: first.creds.email, password: creds.password, nickName: creds.nickName },
    });
    const body = (await res.json()) as Envelope<null>;
    expect(body.code).not.toBe(200); // GlobalException "该邮箱已注册" (code 500)
    expect(body.message).toContain('邮箱');
  } finally {
    await ctx.dispose();
  }
});

// SO-API-006 (P1) — register field validation (invalid email / oversized nickName).
test(localizedTitle("【登录与注册 / API】 SO-API-006 注册字段校验(缺昵称/非法邮箱)", "SO-API-006 register field validation rejects bad input"), async () => {
  skipIfNoPlatform();
  const ctx = await apiContext(platformURL()!);
  try {
    // Malformed email fails @Email validation.
    const badEmail = await ctx.post('/register', {
      data: { email: 'not-an-email', password: 'Passw0rd!e2e', nickName: 'BadEmail' },
    });
    const badEmailBody = (await badEmail.json()) as Envelope<null>;
    expect(badEmailBody.code).not.toBe(200);
    expect(badEmailBody.message).toContain('邮箱');

    // Missing password fails @NotEmpty validation.
    const noPwd = await ctx.post('/register', {
      data: { email: `v_${Date.now()}@test.com`, nickName: 'NoPwd' },
    });
    const noPwdBody = (await noPwd.json()) as Envelope<null>;
    expect(noPwdBody.code).not.toBe(200);
    expect(noPwdBody.message).toContain('密码');

    // Oversized nickName (>20) fails @Length validation.
    const longNick = await ctx.post('/register', {
      data: { email: `v2_${Date.now()}@test.com`, password: 'Passw0rd!e2e', nickName: 'x'.repeat(30) },
    });
    const longNickBody = (await longNick.json()) as Envelope<null>;
    expect(longNickBody.code).not.toBe(200);
    expect(longNickBody.message).toContain('昵称');
  } finally {
    await ctx.dispose();
  }
});

// SO-API-007 (P1) — PUT /refreshToken (header) mints a working LoginVO.
test(localizedTitle("【登录与注册 / API】 SO-API-007 刷新令牌换取新 accessToken", "SO-API-007 refresh token yields a usable accessToken"), async () => {
  skipIfNoPlatform();
  const { login } = await registerAndLogin(platformURL()!);
  expect(login.code).toBe(200);

  const ctx = await apiContext(platformURL()!);
  try {
    const res = await ctx.put('/refreshToken', { headers: { refreshToken: login.data.refreshToken } });
    const body = (await res.json()) as Envelope<LoginVO>;
    expect(body.code).toBe(200);
    expect(typeof body.data.accessToken).toBe('string');
    expect(body.data.accessToken.length).toBeGreaterThan(20);
    expect(body.data.accessTokenExpiresIn).toBeGreaterThan(0);
    expect(body.data.refreshTokenExpiresIn).toBeGreaterThan(0);
  } finally {
    await ctx.dispose();
  }

  // The refreshed accessToken must authenticate a protected route.
  const refresh = await apiContext(platformURL()!);
  let fresh: string;
  try {
    const r = await refresh.put('/refreshToken', { headers: { refreshToken: login.data.refreshToken } });
    fresh = ((await r.json()) as Envelope<LoginVO>).data.accessToken;
  } finally {
    await refresh.dispose();
  }
  const authed = await platformCtx(platformURL()!, fresh);
  try {
    const selfRes = await authed.get('/user/self');
    expect(((await selfRes.json()) as Envelope<{ id: number }>).code).toBe(200);
  } finally {
    await authed.dispose();
  }
});

// SO-API-008 (P2) — missing / forged refreshToken is rejected, no new token issued.
// Live: PUT /refreshToken with no header -> {code:500,"系统繁忙..."}; with a
// garbage token -> {code:500,"您的登录信息已过期，请重新登录"}. Both non-200, data null.
test(localizedTitle("【登录与注册 / API】 SO-API-008 缺失/非法 refreshToken 刷新失败", "SO-API-008 missing/invalid refreshToken is rejected"), async () => {
  skipIfNoPlatform();
  const ctx = await apiContext(platformURL()!);
  try {
    // No refreshToken header at all.
    const noHeader = await ctx.put('/refreshToken');
    const noHeaderBody = (await noHeader.json()) as Envelope<LoginVO | null>;
    expect(noHeaderBody.code).not.toBe(200);
    expect(noHeaderBody.data).toBeFalsy();

    // A well-formed-looking but forged refreshToken.
    const forged = await ctx.put('/refreshToken', {
      headers: { refreshToken: 'forged.refresh.token' },
    });
    const forgedBody = (await forged.json()) as Envelope<LoginVO | null>;
    expect(forgedBody.code).not.toBe(200);
    expect(forgedBody.data).toBeFalsy();
  } finally {
    await ctx.dispose();
  }
});

// SO-API-010 (P2) — change password with the wrong old password is rejected,
// and the original password still works (password unchanged).
test(localizedTitle("【登录与注册 / API】 SO-API-010 修改密码旧密码错误被拒", "SO-API-010 change password with wrong old password is rejected"), async () => {
  skipIfNoPlatform();
  const { creds, login } = await registerAndLogin(platformURL()!);
  expect(login.code).toBe(200);

  const authed = await platformCtx(platformURL()!, login.data.accessToken);
  try {
    const res = await authed.put('/modifyPwd', {
      data: { oldPassword: creds.password + '_nope', newPassword: 'NewPassw0rd!e2e' },
    });
    const body = (await res.json()) as Envelope<null>;
    expect(body.code).not.toBe(200); // "旧密码不正确"
    expect(body.message).toContain('旧密码');
  } finally {
    await authed.dispose();
  }

  // The original password must still authenticate (nothing was changed).
  const ctx = await apiContext(platformURL()!);
  try {
    const withOld = await ctx.post('/login', {
      data: { email: creds.email, password: creds.password, terminal: 0 },
    });
    expect(((await withOld.json()) as Envelope<LoginVO>).code).toBe(200);
  } finally {
    await ctx.dispose();
  }
});

// SO-API-009 (P1) — change password; new password works, old one no longer does.
test(localizedTitle("【登录与注册 / API】 SO-API-009 修改密码成功", "SO-API-009 change password succeeds"), async () => {
  skipIfNoPlatform();
  const { creds, login } = await registerAndLogin(platformURL()!);
  expect(login.code).toBe(200);
  const newPassword = 'NewPassw0rd!e2e';

  const authed = await platformCtx(platformURL()!, login.data.accessToken);
  try {
    const res = await authed.put('/modifyPwd', {
      data: { oldPassword: creds.password, newPassword },
    });
    expect(((await res.json()) as Envelope<null>).code).toBe(200);
  } finally {
    await authed.dispose();
  }

  const ctx = await apiContext(platformURL()!);
  try {
    const withNew = await ctx.post('/login', {
      data: { email: creds.email, password: newPassword, terminal: 0 },
    });
    expect(((await withNew.json()) as Envelope<LoginVO>).code).toBe(200);

    const withOld = await ctx.post('/login', {
      data: { email: creds.email, password: creds.password, terminal: 0 },
    });
    const oldBody = (await withOld.json()) as Envelope<LoginVO | null>;
    expect(oldBody.code).not.toBe(200);
    expect(oldBody.data).toBeFalsy();
  } finally {
    await ctx.dispose();
  }
});

// SO-API-013 (P1) — public paths are reachable without an accessToken header.
// Each must reach business logic (a domain error) rather than the AuthInterceptor
// NO_LOGIN (code 400 "未登录") gate that protected routes hit (see SO-API-011).
test(localizedTitle("【鉴权与会话守卫 / API】 SO-API-013 公共路径无需鉴权可访问", "SO-API-013 public paths need no auth"), async () => {
  skipIfNoPlatform();
  const ctx = await apiContext(platformURL()!);
  try {
    // /login with unknown creds -> business error, NOT NO_LOGIN.
    const login = await ctx.post('/login', { data: { email: 'nobody@x.z', password: 'nope', terminal: 0 } });
    const loginBody = (await login.json()) as Envelope<unknown>;
    expect(loginBody.message).not.toContain('未登录');

    // /register with empty body -> field-validation error, NOT NO_LOGIN.
    const register = await ctx.post('/register', { data: {} });
    const registerBody = (await register.json()) as Envelope<unknown>;
    expect(registerBody.message).not.toContain('未登录');

    // /refreshToken with no header -> its own error, NOT NO_LOGIN.
    const refresh = await ctx.put('/refreshToken');
    const refreshBody = (await refresh.json()) as Envelope<unknown>;
    expect(refreshBody.message).not.toContain('未登录');

    // /file/upload with no token still enters the multipart handler (reachable).
    const upload = await ctx.post('/file/upload', {
      multipart: { file: { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('probe') } },
    });
    const uploadBody = (await upload.json()) as Envelope<unknown>;
    expect(uploadBody.message).not.toContain('未登录');

    // Contrast: a genuinely protected route DOES hit NO_LOGIN without a token.
    const guarded = await ctx.get('/friend/list');
    const guardedBody = (await guarded.json()) as Envelope<unknown>;
    expect(guardedBody.code).toBe(400);
    expect(guardedBody.message).toContain('未登录');
  } finally {
    await ctx.dispose();
  }
});

// SO-API-014 (P1) — expired accessToken rejected.
// DEGRADED SKIP: producing a validly-signed-but-time-expired JWT requires the
// server HMAC secret (out of scope to extract), and the 1800s TTL makes real
// expiry impractical inside an e2e run. Invalid-signature/tampered-token
// rejection (the same 401 INVALID_TOKEN path) is covered by SO-API-012.
test(localizedTitle("【鉴权与会话守卫 / API】 SO-API-014 过期 accessToken 被拒", "SO-API-014 expired accessToken rejected"), async () => {
  test.skip(
    true,
    'Cannot mint a validly-signed expired JWT without the server HMAC secret; ' +
      'real 1800s expiry is impractical in e2e. Tampered-token 401 is covered by SO-API-012.',
  );
});

// SO-API-024 — GET /user/self returns the current user (via a real SIWE token).
test(localizedTitle("【用户资料与搜索 / API】 SO-API-024 获取当前登录用户信息", "SO-API-024 /user/self returns the current user"), async () => {
  skipIfNoPlatform();
  test.skip(!identityURL(), 'SOCIAL_IDENTITY_URL not configured');
  const wallet = Wallet.createRandom();
  const { address, envelope } = await siweLogin(identityURL()!, wallet.privateKey);
  expect(envelope.code).toBe(200);

  const ctx = await platformCtx(platformURL()!, envelope.data.accessToken);
  try {
    const res = await ctx.get('/user/self');
    const body = (await res.json()) as Envelope<{ id: number; walletAddress: string }>;
    expect(body.code).toBe(200);
    expect(body.data.id).toBeGreaterThan(0);
    // The auto-provisioned wallet user carries the (lower-cased) address.
    expect(body.data.walletAddress.toLowerCase()).toBe(address.toLowerCase());
  } finally {
    await ctx.dispose();
  }
});
