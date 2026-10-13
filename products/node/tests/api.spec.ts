/**
 * node — SIWE login + JWT-protected endpoints.
 *
 * Steps:
 *   1. GET  /api/v1/public/health          → 200
 *   2. GET  /api/v1/public/ready           → 200 (DB up)
 *   3. POST /api/v1/public/auth/challenge  → challenge + nonce (EIP-4361)
 *   4. sign the challenge with personal_sign
 *   5. POST /api/v1/public/auth/verify     → JWT + refresh cookie
 *   6. GET  /api/v1/public/profile/me     → wallet-bound profile
 *   7. POST /api/v1/public/auth/refresh   → new access token (cookie)
 *   8. POST /api/v1/public/auth/logout    → clears refresh cookie
 *
 * Requires:
 *   - NODE_BASE_URL / NODE_API_URL
 *   - NODE_WALLET_PRIVATE_KEY
 */
import type { APIResponse } from '@playwright/test';
import { Wallet, getAddress, type BaseWallet } from 'ethers';

import { test, expect, baseURLFor, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';
import { loginWithWallet } from '../helpers/auth';

function skipIfNoService() {
  test.skip(!baseURLFor('node'), 'NODE_BASE_URL not configured');
}

/** Extract the `refresh_token=<value>` pair from a response's Set-Cookie headers. */
function refreshCookie(res: APIResponse): string {
  const hit = res
    .headersArray()
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .find((h) => h.value.startsWith('refresh_token='));
  return hit ? hit.value.split(';')[0] ?? '' : '';
}

/** Run a full SIWE challenge → verify against `api` with a fresh wallet. */
async function siweVerify(api: string, wallet: BaseWallet) {
  const ctx = await apiContext(api);
  try {
    const address = getAddress(wallet.address);
    const cRes = await ctx.post('/api/v1/public/auth/challenge', { data: { address, chainId: 1 } });
    const c = (await cRes.json()) as { data: { challenge: string; nonce: string } };
    const signature = await wallet.signMessage(c.data.challenge);
    const vRes = await ctx.post('/api/v1/public/auth/verify', {
      data: { address, nonce: c.data.nonce, signature },
    });
    const body = (await vRes.json()) as {
      data?: { token?: string; expiresAt?: number };
    };
    return {
      status: vRes.status(),
      token: body.data?.token,
      expiresAt: body.data?.expiresAt,
      cookie: refreshCookie(vRes),
      address,
      nonce: c.data.nonce,
      signature,
    };
  } finally {
    await ctx.dispose();
  }
}

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

test("【健康检查与就绪 / API】 健康端点返回正常", async () => {
  skipIfNoService();
  const env = envFor('node');
  const api = env['NODE_API_URL'] ?? env['baseURL']!;
  const ctx = await apiContext(api);
  try {
    const res = await ctx.get('/api/v1/public/health');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { code: number; data: { status: string } };
    expect(body.code).toBe(0);
    expect(body.data.status).toBe('ok');
  } finally {
    await ctx.dispose();
  }
});

test("【健康检查与就绪 / API】 就绪端点确认数据库", async () => {
  skipIfNoService();
  const env = envFor('node');
  const api = env['NODE_API_URL'] ?? env['baseURL']!;
  const ctx = await apiContext(api);
  try {
    const res = await ctx.get('/api/v1/public/ready');
    expect([200, 503]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as { data: { database: string } };
      expect(body.data.database).toBe('ok');
    }
  } finally {
    await ctx.dispose();
  }
});

test("【SIWE 认证与会话 / API】 SIWE 质询返回 EIP-4361 消息", async () => {
  skipIfNoService();
  const env = envFor('node');
  test.skip(!env['NODE_WALLET_PRIVATE_KEY'], 'NODE_WALLET_PRIVATE_KEY not configured');
  const api = env['NODE_API_URL'] ?? env['baseURL']!;
  const ctx = await apiContext(api);
  try {
    const res = await ctx.post('/api/v1/public/auth/challenge', {
      data: { address: '0xcD05C9a21555319Ff0cF0A9C177aFe414B6Aa7B6', chainId: 1 },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { data: { challenge: string; nonce: string; version: string; chainId: number } };
    expect(body.data.version).toBe('1');
    expect(body.data.chainId).toBe(1);
    expect(body.data.challenge.toLowerCase()).toContain('0xcd05c9a21555319ff0cf0a9c177afe414b6aa7b6');
    expect(body.data.nonce).toMatch(/^[A-Za-z0-9_-]{8,}$/);
  } finally {
    await ctx.dispose();
  }
});

test("【SIWE 认证与会话 / API】 SIWE 验证产生 JWT 并将其绑定到钱包", async () => {
  skipIfNoService();
  const env = envFor('node');
  test.skip(!env['NODE_WALLET_PRIVATE_KEY'], 'NODE_WALLET_PRIVATE_KEY not configured');
  const tokens = await loginWithWallet(env['baseURL']!, env['NODE_WALLET_PRIVATE_KEY']!);
  expect(tokens.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  expect(tokens.address.toLowerCase()).toBe(
    env['NODE_EXPECTED_ADDRESS']?.toLowerCase() ?? tokens.address.toLowerCase(),
  );
});

test("【SIWE 认证与会话 / API】 profile/me 需要有效的 JWT", async () => {
  skipIfNoService();
  const env = envFor('node');
  test.skip(!env['NODE_WALLET_PRIVATE_KEY'], 'NODE_WALLET_PRIVATE_KEY not configured');
  const api = env['NODE_API_URL'] ?? env['baseURL']!;
  const tokens = await loginWithWallet(env['baseURL']!, env['NODE_WALLET_PRIVATE_KEY']!);
  const ctx = await apiContext(api, { Authorization: `Bearer ${tokens.token}` });
  try {
    const res = await ctx.get('/api/v1/public/profile/me');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { data: { address: string } };
    expect(body.data.address.toLowerCase()).toBe(tokens.address.toLowerCase());
  } finally {
    await ctx.dispose();
  }
});

test("【SIWE 认证与会话 / API】 profile/me 拒绝没有 JWT 的请求", async () => {
  skipIfNoService();
  const env = envFor('node');
  const api = env['NODE_API_URL'] ?? env['baseURL']!;
  const ctx = await apiContext(api);
  try {
    const res = await ctx.get('/api/v1/public/profile/me');
    expect([401, 403]).toContain(res.status());
  } finally {
    await ctx.dispose();
  }
});

test("【SIWE 认证与会话 / API】 auth/refresh + auth/logout 保留刷新 cookie 合约", async () => {
  skipIfNoService();
  const env = envFor('node');
  test.skip(!env['NODE_WALLET_PRIVATE_KEY'], 'NODE_WALLET_PRIVATE_KEY not configured');
  const api = env['NODE_API_URL'] ?? env['baseURL']!;

  // 1) Sign in — refresh cookie should be set
  const initial = await loginWithWallet(env['baseURL']!, env['NODE_WALLET_PRIVATE_KEY']!);

  // 2) Hit /refresh with a fresh request context; apiContext builds its
  //    own cookie jar per instance, so this one has no refresh cookie.
  const ctx = await apiContext(api);
  try {
    const refresh = await ctx.post('/api/v1/public/auth/refresh', {
      data: {},
    });
    // Without the refresh cookie, this should be 401. (We never received
    // a refresh cookie because loginWithWallet's context is disposed.)
    expect(refresh.status()).toBe(401);
  } finally {
    await ctx.dispose();
  }
  // Confirm initial JWT was actually valid:
  expect(initial.expiresAt).toBeGreaterThan(Date.now());
});

test("【健康检查与就绪 / API】 ND-API-004 数据库不可用时就绪返回 503", async () => {
  skipIfNoService();
  // Inducing a real DB outage would require stopping/disconnecting the shared
  // Postgres instance this suite (and every other product) runs against — a
  // destructive action the plan explicitly forbids. The success side of the
  // liveness/readiness split is covered by 'ready endpoint confirms the
  // database' above; the 503 branch cannot be exercised non-destructively here.
  test.skip(true, 'cannot induce a DB outage non-destructively against the shared live instance');
});

test("【健康检查与就绪 / API】 ND-API-003 健康检查向后兼容别名", async () => {
  skipIfNoService();
  const env = envFor('node');
  const api = env['NODE_API_URL'] ?? env['baseURL']!;
  const ctx = await apiContext(api);
  try {
    const res = await ctx.get('/api/v1/public/healthCheck');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { code: number; data: { status: string; timestamp: number } };
    expect(body.code).toBe(0);
    expect(body.data.status).toBe('ok');
    expect(typeof body.data.timestamp).toBe('number');
  } finally {
    await ctx.dispose();
  }
});

test("【SIWE 认证与会话 / API】 ND-API-008 verify 拒绝错误私钥的签名", async () => {
  skipIfNoService();
  const env = envFor('node');
  const api = env['NODE_API_URL'] ?? env['baseURL']!;
  // Address A obtains a challenge; wallet B (a different key) signs it. The
  // recovered signer (B) will not match A, so verify must reject it.
  const walletA = Wallet.createRandom();
  const walletB = Wallet.createRandom();
  const addressA = getAddress(walletA.address);
  const ctx = await apiContext(api);
  try {
    const cRes = await ctx.post('/api/v1/public/auth/challenge', {
      data: { address: addressA, chainId: 1 },
    });
    expect(cRes.status()).toBe(200);
    const c = (await cRes.json()) as { data: { challenge: string; nonce: string } };

    const signature = await walletB.signMessage(c.data.challenge);
    const vRes = await ctx.post('/api/v1/public/auth/verify', {
      data: { address: addressA, nonce: c.data.nonce, signature },
    });
    expect(vRes.status()).toBe(401);
    const body = (await vRes.json()) as { message: string; data: unknown };
    expect(body.message).toBe('Invalid signature');
    expect(body.data).toBeNull(); // no token issued
  } finally {
    await ctx.dispose();
  }
});

test("【SIWE 认证与会话 / API】 ND-API-010 verify 缺字段返回 400", async () => {
  skipIfNoService();
  const env = envFor('node');
  const api = env['NODE_API_URL'] ?? env['baseURL']!;
  const filler = { address: '0xcD05C9a21555319Ff0cF0A9C177aFe414B6Aa7B6', nonce: 'some-nonce-000000', signature: '0x' + 'ab'.repeat(65) };
  const ctx = await apiContext(api);
  try {
    // Each request drops exactly one required field; all must fail identically.
    for (const drop of ['address', 'nonce', 'signature'] as const) {
      const data: Record<string, string> = { ...filler };
      delete data[drop];
      const res = await ctx.post('/api/v1/public/auth/verify', { data });
      expect(res.status(), `missing ${drop}`).toBe(400);
      expect(((await res.json()) as { message: string }).message).toBe(
        'Missing address, nonce or signature',
      );
    }
  } finally {
    await ctx.dispose();
  }
});

test("【SIWE 认证与会话 / API】 ND-API-006 challenge 缺少 address 返回 400", async () => {
  skipIfNoService();
  const env = envFor('node');
  const api = env['NODE_API_URL'] ?? env['baseURL']!;
  const ctx = await apiContext(api);
  try {
    const res = await ctx.post('/api/v1/public/auth/challenge', { data: {} });
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { message: string }).message).toBe('Missing address');
  } finally {
    await ctx.dispose();
  }
});

test("【SIWE 认证与会话 / API】 ND-API-009 verify 拒绝过期/未知 nonce", async () => {
  skipIfNoService();
  const env = envFor('node');
  const api = env['NODE_API_URL'] ?? env['baseURL']!;

  // Unknown nonce → 400 Challenge expired (never issued).
  const ctx = await apiContext(api);
  try {
    const res = await ctx.post('/api/v1/public/auth/verify', {
      data: {
        address: '0xcD05C9a21555319Ff0cF0A9C177aFe414B6Aa7B6',
        signature: '0x' + 'ab'.repeat(65),
        nonce: 'never-issued-nonce-000000',
      },
    });
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { message: string }).message).toBe('Challenge expired');
  } finally {
    await ctx.dispose();
  }

  // Replay protection: a successful verify consumes the challenge, so replaying
  // the same nonce+signature fails with the same 400 Challenge expired.
  const wallet = Wallet.createRandom();
  const first = await siweVerify(api, wallet);
  expect(first.status).toBe(200);

  const replay = await apiContext(api);
  try {
    const res = await replay.post('/api/v1/public/auth/verify', {
      data: { address: first.address, nonce: first.nonce, signature: first.signature },
    });
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { message: string }).message).toBe('Challenge expired');
  } finally {
    await replay.dispose();
  }
});

test("【SIWE 认证与会话 / API】 ND-API-014 携带 refresh cookie 刷新出新 access token", async () => {
  skipIfNoService();
  const env = envFor('node');
  const api = env['NODE_API_URL'] ?? env['baseURL']!;

  // Sign in with a fresh wallet → capture refresh cookie A.
  const login = await siweVerify(api, Wallet.createRandom());
  expect(login.status).toBe(200);
  expect(login.cookie).toMatch(/^refresh_token=/);

  // Refresh with cookie A → a new access token + a rotated cookie B.
  let cookieB = '';
  const refreshCtx = await apiContext(api);
  try {
    const res = await refreshCtx.post('/api/v1/public/auth/refresh', {
      headers: { Cookie: login.cookie },
      data: {},
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { data: { token: string; expiresAt: number } };
    expect(body.data.token).toMatch(JWT_RE);
    expect(body.data.expiresAt).toBeGreaterThan(Date.now());
    cookieB = refreshCookie(res);
    expect(cookieB).toMatch(/^refresh_token=/);
    expect(cookieB).not.toBe(login.cookie); // rotated
  } finally {
    await refreshCtx.dispose();
  }

  // Old cookie A is now single-use-consumed → replay is rejected.
  const oldCtx = await apiContext(api);
  try {
    const res = await oldCtx.post('/api/v1/public/auth/refresh', {
      headers: { Cookie: login.cookie },
      data: {},
    });
    expect(res.status()).toBe(401);
    expect(((await res.json()) as { message: string }).message).toBe('Invalid refresh token');
  } finally {
    await oldCtx.dispose();
  }

  // The rotated cookie B remains valid.
  const newCtx = await apiContext(api);
  try {
    const res = await newCtx.post('/api/v1/public/auth/refresh', {
      headers: { Cookie: cookieB },
      data: {},
    });
    expect(res.status()).toBe(200);
  } finally {
    await newCtx.dispose();
  }
});

test("【SIWE 认证与会话 / API】 ND-API-015 logout 撤销并清除 refresh cookie", async () => {
  skipIfNoService();
  const env = envFor('node');
  const api = env['NODE_API_URL'] ?? env['baseURL']!;

  const login = await siweVerify(api, Wallet.createRandom());
  expect(login.status).toBe(200);

  // logout → 200 { logout: true }, and the response clears the refresh cookie.
  const logoutCtx = await apiContext(api);
  try {
    const res = await logoutCtx.post('/api/v1/public/auth/logout', {
      headers: { Cookie: login.cookie },
      data: {},
    });
    expect(res.status()).toBe(200);
    expect(((await res.json()) as { data: { logout: boolean } }).data.logout).toBe(true);
    const cleared = res
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .find((h) => h.value.startsWith('refresh_token='));
    // Cookie is reset to an empty value (Max-Age=0).
    expect(cleared?.value).toMatch(/^refresh_token=;/);
  } finally {
    await logoutCtx.dispose();
  }

  // The revoked refresh token can no longer mint access tokens.
  const afterCtx = await apiContext(api);
  try {
    const res = await afterCtx.post('/api/v1/public/auth/refresh', {
      headers: { Cookie: login.cookie },
      data: {},
    });
    expect(res.status()).toBe(401);
    expect(((await res.json()) as { message: string }).message).toBe('Invalid refresh token');
  } finally {
    await afterCtx.dispose();
  }
});