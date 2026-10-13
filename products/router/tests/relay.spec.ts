/**
 * router — OpenAI-compatible relay auth boundary (RT-API-044 / RT-API-045).
 *
 * The relay group (`POST /api/v1/public/chat/completions`, `/models`, …) is
 * guarded by `TokenAuth` (API-key `sk-…`) + `Distribute`. Actually routing a
 * completion to an upstream requires a provisioned API key AND account quota +
 * available models — neither of which this wallet account has (models require a
 * purchase, the external-payment boundary). So per the agreed scope this is
 * exercised only to the *authorization* boundary:
 *
 *   - no credentials          → 401, one-api error "未提供令牌"
 *   - a user-session JWT       → 401, "无效的令牌" (JWTs are not API keys)
 *   - a forged `sk-…` key      → 401
 *
 * Failures come back as the one-api error envelope `{ error: { message, type } }`
 * with HTTP 401 — the request is rejected before any upstream is contacted.
 */
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';
import { acquireRouterToken } from '../helpers/auth';

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}

const CHAT = '/api/v1/public/chat/completions';
const chatBody = { model: 'gpt-4o', messages: [{ role: 'user', content: 'ping' }] };

// RT-API-045 (P1)
test("【模型中继与个人供应商 / API】 中继通过 401 拒绝丢失和伪造的令牌（无上游路由）", async () => {
  skipIfNoService();
  const ctx = await apiContext(baseURLFor('router')!);
  try {
    const noAuth = await ctx.post(CHAT, { data: chatBody });
    expect(noAuth.status()).toBe(401);
    const noAuthBody = (await noAuth.json()) as { error?: { message?: string } };
    expect(noAuthBody.error?.message ?? '').toMatch(/未提供令牌|token/i);

    const forged = await apiContext(baseURLFor('router')!, {
      Authorization: 'Bearer sk-forged-000000000000000000000000',
    });
    try {
      const res = await forged.post(CHAT, { data: chatBody });
      expect(res.status()).toBe(401);
    } finally {
      await forged.dispose();
    }
  } finally {
    await ctx.dispose();
  }
});

// RT-API-044 (P0) — boundary only: a user JWT is not an API key, so TokenAuth
// rejects it before any distribution/upstream relay + quota deduction happens.
test("【模型中继与个人供应商 / API】 通过用户 JWT 的中继被 TokenAuth 拒绝（中继边界）", async () => {
  skipIfNoService();
  test.skip(
    !envFor('router')['ROUTER_WALLET_PRIVATE_KEY'],
    'ROUTER_WALLET_PRIVATE_KEY not configured',
  );
  const baseURL = baseURLFor('router')!;
  const { token } = await acquireRouterToken(baseURL);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    const res = await ctx.post(CHAT, { data: chatBody });
    // The wallet JWT is not accepted by the TokenAuth relay chain.
    expect(res.status()).toBe(401);
    const body = (await res.json()) as { error?: { message?: string; type?: string } };
    expect(body.error?.message ?? '').toMatch(/无效的令牌|令牌|token/i);
    test.info().annotations.push({
      type: 'boundary',
      description:
        'no API key/quota/models on this account; relay verified to the TokenAuth boundary only',
    });
  } finally {
    await ctx.dispose();
  }
});

// RT-API-046 (P2) — the RelayNotImplemented endpoints are wired and controlled.
//
// Endpoints such as GET /files and POST /fine_tuning/jobs map to
// `controller.RelayNotImplemented` but sit *behind* TokenAuth, so reaching the
// "not implemented" body requires a valid `sk-…` API key (which needs purchased
// models — the external-payment boundary). We verify to the reachable boundary:
// the routes ARE registered (a controlled 401 one-api envelope, not a 404
// "Invalid URL" and never a 5xx), proving they are wired and gated rather than
// crashing. Contrast: an unregistered path returns 404 invalid_request_error.
test("【OpenAI 兼容模型与中继 / API】 RT-API-046 未实现的中继端点返回 not implemented", async () => {
  skipIfNoService();
  const forged = await apiContext(baseURLFor('router')!, {
    Authorization: 'Bearer sk-forged-000000000000000000000000',
  });
  try {
    for (const path of ['/api/v1/public/files', '/api/v1/public/fine_tuning/jobs']) {
      const res = await forged.get(path);
      // Registered + gated: TokenAuth rejects the forged key with a controlled
      // 401 one-api envelope — not a 404 (unregistered) and not a 5xx (crash).
      expect(res.status()).toBe(401);
      const body = (await res.json()) as { error?: { type?: string; message?: string } };
      expect(body.error?.type).toBe('one_api_error');
    }
    test.info().annotations.push({
      type: 'boundary',
      description:
        'reaching the RelayNotImplemented body needs a valid sk- API key (purchased models = payment boundary); verified to the TokenAuth gating boundary',
    });
  } finally {
    await forged.dispose();
  }
});

// RT-API-047 (P2) — with DISABLE_OPENAI_COMPAT the legacy /v1/* routes are off.
//
// DEGRADED SKIP unless the deployment was started with DISABLE_OPENAI_COMPAT.
// This is a start-time flag, so we detect it live: if the legacy
// `/v1/chat/completions` is still registered (TokenAuth answers 401 rather than
// a 404 "Invalid URL"), compat is ENABLED here and the disabled branch is
// unreachable — skip. The canonical `/api/v1/public/*` entry is always asserted
// to remain the live gated surface.
test("【OpenAI 兼容模型与中继 / API】 RT-API-047 DISABLE_OPENAI_COMPAT 时旧 /v1/* 路径被禁用", async () => {
  skipIfNoService();
  const ctx = await apiContext(baseURLFor('router')!);
  try {
    // The canonical entry is always present and gated (401), never 404.
    const canonical = await ctx.post(CHAT, { data: chatBody });
    expect(canonical.status()).toBe(401);

    const legacy = await ctx.post('/v1/chat/completions', { data: chatBody });
    const legacyBody = (await legacy.json()) as {
      error?: { type?: string; message?: string };
    };
    // Compat ON → the legacy route is registered and gated by TokenAuth (401).
    // Compat OFF → the route is gone (404 invalid_request_error / not found).
    const compatEnabled =
      legacy.status() === 401 ||
      (legacy.status() !== 404 && legacyBody.error?.type === 'one_api_error');
    test.skip(
      compatEnabled,
      'DISABLE_OPENAI_COMPAT is not set on this deployment: the legacy /v1/* routes are still ' +
        'registered (compat enabled), so the disabled branch cannot be exercised',
    );

    // Disabled branch: the legacy path is no longer routed.
    expect(legacy.status()).toBe(404);
  } finally {
    await ctx.dispose();
  }
});

// RT-API-048 (P2) — relay calls are written to the user route log (queryable).
//
// The GET /log read contract is asserted directly. Populating a *relay* record
// requires a real completion (API key + quota + models = external-payment
// boundary), so the "list contains the relay call" branch runs only when the
// account already has log rows; otherwise it is annotated as boundary-limited.
// The /log/:id detail contract is pinned via its controlled not-found response.
test("【OpenAI 兼容模型与中继 / API】 RT-API-048 中继调用写入路由日志可查", async () => {
  skipIfNoService();
  test.skip(
    !envFor('router')['ROUTER_WALLET_PRIVATE_KEY'],
    'ROUTER_WALLET_PRIVATE_KEY not configured',
  );
  const baseURL = baseURLFor('router')!;
  const { token } = await acquireRouterToken(baseURL);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    const res = await ctx.get('/api/v1/public/log');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      success?: boolean;
      data?: Array<{ id?: string | number }>;
      meta?: { page?: number; total?: number };
    };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.meta?.total).toBe('number');

    const first = (body.data ?? [])[0];
    if (first?.id) {
      const detail = await ctx.get(`/api/v1/public/log/${first.id}`);
      expect(detail.status()).toBe(200);
      const detailBody = (await detail.json()) as { success?: boolean; data?: unknown };
      expect(detailBody.success).toBe(true);
    } else {
      // No log rows to fetch a detail for: pin the controlled not-found contract
      // for a non-existent id instead (never a 5xx).
      const missing = await ctx.get('/api/v1/public/log/nonexistent-log-id');
      expect(missing.status()).toBe(200);
      const missingBody = (await missing.json()) as { success?: boolean; message?: string };
      expect(missingBody.success).toBe(false);
      expect(missingBody.message ?? '').toMatch(/日志不存在|不存在|not found/i);
      test.info().annotations.push({
        type: 'boundary',
        description:
          'account has no relay log rows (a real completion needs API key + quota + models = payment boundary); log read + detail contract verified',
      });
    }
  } finally {
    await ctx.dispose();
  }
});
