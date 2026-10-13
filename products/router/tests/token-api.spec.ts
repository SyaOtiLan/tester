/**
 * router — Token CRUD API contract (mutating, self-cleaning).
 *
 * `POST /api/v1/public/token/` is gated by the backend "available models"
 * check *before* it validates the request body — an account with no purchased
 * models is answered `{success:false, message:"当前账号暂无可用模型…"}` (HTTP
 * 200). Purchasing models is the external-payment boundary we don't cross, so:
 *
 *   - RT-API-024: attempt a real create. Funded account → id+key returned, then
 *     deleted in `finally`. Unfunded account → assert the create reached the
 *     models gate (nothing written). Either branch is an honest assertion.
 *   - RT-API-026: a create missing `name` is rejected (param error *or* the
 *     models gate, whichever the backend reaches first).
 *   - RT-API-027: `GET /token/` returns a well-formed paginated list.
 *   - RT-API-030: `GET /token/search` returns a well-formed (possibly empty)
 *     result set for a non-matching keyword.
 *
 * Verified against router `internal/admin/controller/token/*` + api.go routes.
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

interface CreateResp {
  success?: boolean;
  message?: string;
  data?: { id?: string | number; key?: string };
}

// RT-API-024 (P0)
test("【令牌、充值与余额 / API】 POST /token/ 创建一个令牌（或到达模型门）", async () => {
  skipIfNoService();
  skipIfNoKey();
  const baseURL = baseURLFor('router')!;
  const { token } = await acquireRouterToken(baseURL);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  const name = `e2e-tok-api-${Date.now()}`;
  let createdId = '';
  try {
    const res = await ctx.post('/api/v1/public/token/', { data: { name } });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as CreateResp;

    if (body.success) {
      // Funded account: a fresh id (and one-time key) is returned.
      createdId = String(body.data?.id ?? '');
      expect(createdId).not.toBe('');
      test.info().annotations.push({ type: 'branch', description: 'funded: token created' });
    } else {
      // Unfunded account: the backend gates creation on available models.
      expect(body.message ?? '').toMatch(/暂无可用模型|available model|购买套餐|充值/i);
      test.info().annotations.push({
        type: 'boundary',
        description: 'no available models — create verified to the backend gate only',
      });
    }
  } finally {
    if (createdId) {
      await ctx.delete(`/api/v1/public/token/${createdId}/`).catch(() => {});
    }
    await ctx.dispose();
  }
});

// RT-API-026 (P1) — parameter validation on token create.
// The backend ACCEPTS an empty name: validateToken (handler.go) only rejects a name
// longer than 30 chars, and it runs BEFORE the models-entitlement gate. So an
// over-long name is the real, deterministic validation boundary — it is refused
// regardless of whether the account has available models, writes nothing, and leaks
// no key.
test("【令牌、充值与余额 / API】 名称过长的 POST /token/ 被参数验证拒绝", async () => {
  skipIfNoService();
  skipIfNoKey();
  const baseURL = baseURLFor('router')!;
  const { token } = await acquireRouterToken(baseURL);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    const res = await ctx.post('/api/v1/public/token/', { data: { name: 'x'.repeat(31) } });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as CreateResp;
    expect(body.success).toBe(false);
    expect(body.data?.key).toBeUndefined();
    expect(body.message ?? '').toMatch(/参数错误|令牌名称过长/);
  } finally {
    await ctx.dispose();
  }
});

// RT-API-027 (P1)
test("【令牌、充值与余额 / API】 GET /token/ 返回格式良好的分页列表", async () => {
  skipIfNoService();
  skipIfNoKey();
  const baseURL = baseURLFor('router')!;
  const { token } = await acquireRouterToken(baseURL);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    const res = await ctx.get('/api/v1/public/token/');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { success?: boolean; data?: unknown; meta?: unknown };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);

    // If any token exists, GET /token/:id returns that token's detail.
    const first = (body.data as Array<{ id?: string | number }>)[0];
    test.skip(!first?.id, 'account has no tokens to fetch a detail for');
    const detail = await ctx.get(`/api/v1/public/token/${first!.id}`);
    expect(detail.status()).toBe(200);
    const detailBody = (await detail.json()) as { success?: boolean; data?: { id?: unknown } };
    expect(detailBody.success).toBe(true);
    expect(String(detailBody.data?.id)).toBe(String(first!.id));
  } finally {
    await ctx.dispose();
  }
});

// RT-API-025 (P1) — POST /token/ is gated when the account has no available models.
test("【令牌、充值与余额 / API】 POST /token/ 被无可用模型门阻止", async () => {
  skipIfNoService();
  skipIfNoKey();
  const baseURL = baseURLFor('router')!;
  const { token } = await acquireRouterToken(baseURL);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    // Only meaningful for an account with no available models (the gate under
    // test). A funded account would legitimately create a token, so skip there.
    const models = (await (await ctx.get('/api/v1/public/user/models/available')).json()) as {
      data?: unknown[];
    };
    test.skip(
      Array.isArray(models.data) && models.data.length > 0,
      'account now has available models — the no-models gate does not apply',
    );

    const res = await ctx.post('/api/v1/public/token/', { data: { name: `e2e-gate-${Date.now()}` } });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as CreateResp;
    // Gated before creation: success:false, models-gate message, no key leaked.
    expect(body.success).toBe(false);
    expect(body.data?.key).toBeUndefined();
    expect(body.message ?? '').toMatch(/暂无可用模型|购买套餐|充值|available model/i);
  } finally {
    await ctx.dispose();
  }
});

// RT-API-028 (P1) — PUT /token/ updates an existing token (round-trip).
test("【令牌、充值与余额 / API】 PUT /token/ 更新令牌并反映更改", async () => {
  skipIfNoService();
  skipIfNoKey();
  const baseURL = baseURLFor('router')!;
  const { token } = await acquireRouterToken(baseURL);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    const listBody = (await (await ctx.get('/api/v1/public/token/')).json()) as {
      data?: Array<{ id?: string | number; name?: string }>;
    };
    const existing = (listBody.data ?? [])[0];
    // Updating needs a real token. Minting one requires available models
    // (a purchase — the external-payment boundary), so when the account has no
    // token we cannot exercise the update and skip cleanly.
    test.skip(
      !existing?.id,
      'account has no token to update; minting one needs purchased models (payment boundary)',
    );

    const newName = `e2e-upd-${Date.now()}`;
    const put = await ctx.put('/api/v1/public/token/', {
      data: { id: existing!.id, name: newName, status: 1 },
    });
    expect(put.status()).toBe(200);
    const putBody = (await put.json()) as { success?: boolean; message?: string };
    expect(putBody.success).toBe(true);

    const detail = (await (await ctx.get(`/api/v1/public/token/${existing!.id}`)).json()) as {
      data?: { name?: string };
    };
    expect(detail.data?.name).toBe(newName);
  } finally {
    await ctx.dispose();
  }
});

// RT-API-029 (P1) — DELETE /token/:id is controlled and idempotent.
test("【令牌、充值与余额 / API】 DELETE /token/:id 是受控且幂等的（重新删除时没有 5xx）", async () => {
  skipIfNoService();
  skipIfNoKey();
  const baseURL = baseURLFor('router')!;
  const { token } = await acquireRouterToken(baseURL);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    // The create-backed happy path (create → delete → gone) requires available
    // models and is covered by token-lifecycle.spec's funded branch. Here we
    // pin the endpoint's *controlled + idempotent* contract on an id the account
    // does not own: it must answer 200 success:false (never 5xx), and repeating
    // the delete yields the same controlled result.
    const ghostId = `e2e-ghost-${Date.now()}`;
    const first = await ctx.delete(`/api/v1/public/token/${ghostId}`);
    expect(first.status()).toBe(200);
    const firstBody = (await first.json()) as { success?: boolean; message?: string };
    expect(firstBody.success).toBe(false);

    const second = await ctx.delete(`/api/v1/public/token/${ghostId}`);
    expect(second.status()).toBe(200);
    const secondBody = (await second.json()) as { success?: boolean };
    expect(secondBody.success).toBe(false);
  } finally {
    await ctx.dispose();
  }
});

// RT-API-030 (P2)
test("【令牌、充值与余额 / API】 GET /token/search 返回格式正确的结果集", async () => {
  skipIfNoService();
  skipIfNoKey();
  const baseURL = baseURLFor('router')!;
  const { token } = await acquireRouterToken(baseURL);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    // A keyword that cannot match any real token → empty but well-formed.
    const res = await ctx.get(`/api/v1/public/token/search?keyword=zzz-no-such-${Date.now()}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { success?: boolean; data?: unknown };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect((body.data as unknown[]).length).toBe(0);
  } finally {
    await ctx.dispose();
  }
});

// RT-API-031 (P2) — token/status returns quota status when called with an API Key.
//
// DEGRADED SKIP: `GET /token/status` is guarded by TokenAuth, which accepts only
// a minted `sk-…` API key — never a user JWT (that JWT-rejection boundary is
// covered by RT-API-023 in authz.spec). Minting an API key needs the account to
// have available models, which requires a purchase — the external-payment
// boundary this suite does not cross. Probe available models live; with none,
// no key can be minted and the API-Key branch is unreachable, so we skip.
test("【令牌(Token)生命周期 / API】 RT-API-031 token/status 以 API Key 返回额度状态", async () => {
  skipIfNoService();
  skipIfNoKey();
  const baseURL = baseURLFor('router')!;
  const { token } = await acquireRouterToken(baseURL);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    const models = (await (await ctx.get('/api/v1/public/user/models/available')).json()) as {
      data?: unknown[];
    };
    test.skip(
      !Array.isArray(models.data) || models.data.length === 0,
      'account has no available models, so no API key can be minted; ' +
        'the token/status API-Key branch (RT-API-031) needs purchased models (payment boundary)',
    );

    // Funded account: mint a token, then read its status with the API Key.
    const create = (await (
      await ctx.post('/api/v1/public/token/', { data: { name: `e2e-status-${Date.now()}` } })
    ).json()) as { success?: boolean; data?: { id?: string | number; key?: string } };
    expect(create.success).toBe(true);
    const key = create.data?.key ?? '';
    const id = String(create.data?.id ?? '');
    // The API returns the raw key (random.GenerateKey(): 48 chars, NO prefix). The
    // `sk-` prefix only appears in the UI's copy/cURL rendering (renderFullToken),
    // not in the API payload — so assert the raw shape here.
    expect(key).not.toBe('');
    expect(key.length).toBeGreaterThanOrEqual(40);
    expect(key.startsWith('sk-')).toBe(false);
    const keyCtx = await apiContext(baseURL, { Authorization: `Bearer ${key}` });
    try {
      const res = await keyCtx.get('/api/v1/public/token/status');
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { data?: Record<string, unknown> };
      expect(body.data).toBeTruthy();
    } finally {
      await keyCtx.dispose();
      if (id) await ctx.delete(`/api/v1/public/token/${id}/`).catch(() => {});
    }
  } finally {
    await ctx.dispose();
  }
});
