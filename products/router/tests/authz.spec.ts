/**
 * router — authorization boundaries + the hybrid-envelope contract.
 *
 * These pin the three distinct response shapes this product exposes (a real
 * source of cross-envelope bugs), plus the auth gates:
 *
 *   - proto envelope   `{ success, message, data }`  — /common/auth/verify, /user/*
 *   - SDK envelope     `{ code, data, message, timestamp }` — /profile only
 *   - relay/one-api    `{ error: { code, message, type } }` (HTTP 401) — TokenAuth
 *
 * NOTE (contract discrepancy vs docs): the case doc claims `/user/*` uses the
 * SDK `{code,...}` envelope, but the live service returns the proto
 * `{success,...}` envelope for `/user/self`, `/user/dashboard`, etc. Only
 * `/profile` uses the `{code,...}` SDK envelope. Assertions below reflect the
 * *live* contract.
 *
 * AdminAuth returns HTTP 200 with `{success:false, message:"…权限不足"}` for an
 * under-privileged user (not a 403 status), so RT-API-021 accepts either.
 */
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';
import { acquireRouterToken } from '../helpers/auth';

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}
function skipIfNoKey() {
  test.skip(!envFor('router')['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');
}

// RT-API-021 (P0)
test("【鉴权与权限边界 / API】 普通用户 JWT 被拒绝访问 /api/v1/admin/*", async () => {
  skipIfNoService();
  skipIfNoKey();
  const baseURL = baseURLFor('router')!;
  const { token } = await acquireRouterToken(baseURL);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    for (const path of ['/api/v1/admin/user/', '/api/v1/admin/dashboard/']) {
      const res = await ctx.get(path);
      // AdminAuth denies with HTTP 200 + success:false ("权限不足"); accept 403 too
      // in case the deployment is configured to return a hard status.
      if (res.status() === 403) continue;
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { success?: boolean; message?: string };
      expect(body.success).toBe(false);
      expect(body.message ?? '').toMatch(/权限不足|无权|forbidden/i);
    }
  } finally {
    await ctx.dispose();
  }
});

// RT-API-019 + RT-API-020 (P1)
test("【鉴权与权限边界 / API】 UserAuth 和令牌 CRUD 端点拒绝未经身份验证的请求，返回 401", async () => {
  skipIfNoService();
  const ctx = await apiContext(baseURLFor('router')!);
  try {
    const getPaths = [
      '/api/v1/public/user/self',
      '/api/v1/public/user/dashboard',
      '/api/v1/public/user/quota/summary',
      '/api/v1/public/token/',
    ];
    for (const path of getPaths) {
      const res = await ctx.get(path);
      expect(res.status()).toBe(401);
    }
    // POST /token/ without a JWT must also be rejected (no token data leaked).
    const post = await ctx.post('/api/v1/public/token/', { data: {} });
    expect(post.status()).toBe(401);
  } finally {
    await ctx.dispose();
  }
});

// RT-API-043 (P1) — /api/v1/public/models requires an API Key (TokenAuth).
test("【鉴权与权限边界 / API】 GET /api/v1/public/models 使用 401 拒绝非 API-Key 凭据", async () => {
  skipIfNoService();

  // No credentials at all → TokenAuth 401.
  const anon = await apiContext(baseURLFor('router')!);
  try {
    const r1 = await anon.get('/api/v1/public/models');
    expect(r1.status()).toBe(401);
  } finally {
    await anon.dispose();
  }

  // A forged sk-… key is not a valid API key.
  const forged = await apiContext(baseURLFor('router')!, {
    Authorization: 'Bearer sk-forged-000000000000000000000000',
  });
  try {
    const res = await forged.get('/api/v1/public/models');
    expect(res.status()).toBe(401);
    const body = (await res.json()) as { error?: { message?: string; type?: string } };
    expect(body.error?.type).toBe('one_api_error');
    expect(body.error?.message ?? '').toMatch(/无效的令牌|token/i);
  } finally {
    await forged.dispose();
  }

  // A user-session JWT is also not accepted by TokenAuth. The endpoint accepts
  // only a minted `sk-` key, which itself requires purchased models — the
  // external-payment boundary — so we verify only to the TokenAuth boundary.
  skipIfNoKey();
  const baseURL = baseURLFor('router')!;
  const { token } = await acquireRouterToken(baseURL);
  const jwtCtx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    const res = await jwtCtx.get('/api/v1/public/models');
    expect(res.status()).toBe(401);
    const body = (await res.json()) as { error?: { message?: string; type?: string } };
    expect(body.error?.type).toBe('one_api_error');
    expect(body.error?.message ?? '').toMatch(/无效的令牌|token/i);
    test.info().annotations.push({
      type: 'boundary',
      description:
        'no API key minted (account has no available models) — models endpoint verified to the TokenAuth boundary only; minting an sk- key requires purchased models (payment boundary)',
    });
  } finally {
    await jwtCtx.dispose();
  }
});

// RT-API-023 (P2)
test("【鉴权与权限边界 / API】 token/status 需要 API 密钥 (TokenAuth)，而不是用户 JWT", async () => {
  skipIfNoService();
  skipIfNoKey();
  const baseURL = baseURLFor('router')!;
  const { token } = await acquireRouterToken(baseURL);

  // No credentials at all → TokenAuth 401 (one-api error envelope).
  const anon = await apiContext(baseURL);
  try {
    const res = await anon.get('/api/v1/public/token/status');
    expect(res.status()).toBe(401);
  } finally {
    await anon.dispose();
  }

  // A user session JWT is NOT accepted by the TokenAuth chain.
  const jwtCtx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    const res = await jwtCtx.get('/api/v1/public/token/status');
    expect(res.status()).toBe(401);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message ?? '').toMatch(/令牌|token/i);
  } finally {
    await jwtCtx.dispose();
  }
});

// RT-API-018 + RT-API-022 + RT-API-042 (P1/P2)
test("【鉴权与权限边界 / API】 验证和配置文件使用不同的信封； user/self 返回帐户", async () => {
  skipIfNoService();
  skipIfNoKey();
  const baseURL = baseURLFor('router')!;
  const { token, address } = await acquireRouterToken(baseURL);

  // Re-run a raw verify to inspect the envelope directly (proto: no top-level code).
  const raw = await apiContext(baseURL);
  try {
    const { Wallet } = await import('ethers');
    const wallet = new Wallet(envFor('router')['ROUTER_WALLET_PRIVATE_KEY']!);
    // Retry across the shared-wallet single-nonce race until verify succeeds.
    let vBody: Record<string, unknown> & { success?: boolean; data?: { user?: { id?: string } } } = {};
    for (let attempt = 0; attempt < 6; attempt++) {
      const cRes = await raw.post('/api/v1/public/common/auth/challenge', { data: { address } });
      const cBody = (await cRes.json()) as { data: { message: string; nonce: string } };
      const signature = await wallet.signMessage(cBody.data.message);
      const vRes = await raw.post('/api/v1/public/common/auth/verify', {
        data: { address, signature, nonce: cBody.data.nonce, message: cBody.data.message },
      });
      vBody = (await vRes.json()) as typeof vBody;
      if (vBody.success) break;
      await new Promise(r => setTimeout(r, 50 + Math.floor(Math.random() * 150)));
    }
    // RT-API-018: verify is the proto envelope — success present, code absent.
    expect(vBody).toHaveProperty('success');
    expect(vBody).not.toHaveProperty('code');
    // RT-API-022: user.id may carry trailing whitespace; trim before comparing.
    const rawId = vBody.data?.user?.id ?? '';
    expect(rawId.trim().length).toBeGreaterThan(0);
  } finally {
    await raw.dispose();
  }

  const authed = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    // RT-API-018: profile is the SDK envelope — code present, success absent.
    const pRes = await authed.get('/api/v1/public/profile');
    expect(pRes.status()).toBe(200);
    const pBody = (await pRes.json()) as Record<string, unknown> & { data?: { address?: string } };
    expect(pBody).toHaveProperty('code');
    expect(pBody).toHaveProperty('timestamp');
    expect(pBody).not.toHaveProperty('success');
    expect((pBody.code as number)).toBe(0);
    expect((pBody.data?.address ?? '').toLowerCase()).toBe(address.toLowerCase());

    // RT-API-042: user/self returns id/username/wallet_address/role/status.
    const sRes = await authed.get('/api/v1/public/user/self');
    expect(sRes.status()).toBe(200);
    const sBody = (await sRes.json()) as {
      data?: { id?: string; username?: string; wallet_address?: string; role?: number; status?: number };
    };
    expect(sBody.data?.id?.trim()).toBeTruthy();
    expect(sBody.data?.username).toBeTruthy();
    expect((sBody.data?.wallet_address ?? '').toLowerCase()).toBe(address.toLowerCase());
    expect(typeof sBody.data?.role).toBe('number');
    expect(typeof sBody.data?.status).toBe('number');
  } finally {
    await authed.dispose();
  }
});
