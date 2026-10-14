/**
 * router — 渠道与供应商管理 (Channel & Provider administration), operator-level.
 *
 * Channels are the OPERATOR's global upstreams (admin-scoped, under
 * `/api/v1/admin/channel/*` for item ops, `/api/v1/admin/channels/` for the
 * list) — distinct from user-level personal providers. Routing ("渠道切换")
 * selects among ENABLED + published channels by priority tier + weighted
 * random with failover, so these tests never leave an *enabled* test channel
 * behind: every created channel uses `status: 2` (ChannelStatusManuallyDisabled
 * — inert, never selected for routing, never contacts an upstream on create)
 * and is hard-deleted in `finally`. That keeps the suite safe to run against a
 * shared live router.
 *
 * Contracts pinned here were captured live:
 *   - envelope `{success, message, data}`; admin authz failures are HTTP 200
 *     `success:false` message「无权进行此操作，权限不足」; missing auth → HTTP 401
 *     「…未登录且未提供 access token」.
 *   - channel `key` is redacted on read (`key:""`, `key_set:true`,
 *     `key_preview:"sk-*ake"`) — the full secret is never echoed.
 *   - create id echo `{data:{id}}`; duplicate name「渠道标识已存在」; empty name
 *     「渠道标识不能为空」; test with no models「未找到可用于测试的模型」; bad refresh
 *     action「不支持的刷新动作」; missing provider「供应商不存在」.
 *
 * Requires `ROUTER_ADMIN_PRIVATE_KEY` (a wallet listed in the deployment's
 * `bootstrap.root_wallet_address`). Without it these are skipped.
 *
 * Verified against router `internal/admin/controller/channel/handler.go`,
 * `provider.go`, `model_task_handlers.go`, `internal/transport/http/router/api.go`.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';
import { acquireRouterToken, acquireAdminToken } from '../helpers/auth';

const CH = '/api/v1/admin/channel';       // item ops (singular)
const CHS = '/api/v1/admin/channels';     // list (plural)
const PROV = '/api/v1/admin/providers';

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}
function skipIfNoAdminKey() {
  test.skip(!envFor('router')['ROUTER_ADMIN_PRIVATE_KEY'], 'ROUTER_ADMIN_PRIVATE_KEY not configured');
}
function skipIfNoUserKey() {
  test.skip(!envFor('router')['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');
}

interface Envelope<T = unknown> {
  success?: boolean;
  message?: string;
  data?: T;
}

async function adminContext(baseURL: string) {
  const { token } = await acquireAdminToken(baseURL);
  return apiContext(baseURL, { Authorization: `Bearer ${token}` });
}

/** Create an inert (disabled, no models) channel and return its trimmed id. */
async function createInertChannel(ctx: Awaited<ReturnType<typeof adminContext>>, name: string): Promise<string> {
  const res = await ctx.post(`${CH}/`, {
    data: { name, protocol: 'openai', key: 'sk-fake-key', base_url: 'https://api.openai.com', status: 2, models: '' },
  });
  const body = (await res.json()) as Envelope<{ id: string }>;
  expect(body.success, `create channel ${name}: ${body.message}`).toBe(true);
  return (body.data!.id ?? '').trim();
}

// RT-API-059 (P0) — channel CRUD round-trip; key redacted; delete idempotent.
test(localizedTitle("【渠道与供应商管理 / API】 管理员渠道增删改查闭环；密钥脱敏；重复删除保持幂等", "admin channel CRUD round-trip; key is redacted; delete is idempotent"), async () => {
  skipIfNoService();
  skipIfNoAdminKey();
  const ctx = await adminContext(baseURLFor('router')!);
  const name = `e2e-inert-${Date.now()}`;
  let id = '';
  try {
    id = await createInertChannel(ctx, name);
    expect(id).not.toBe('');

    // read: full key never echoed; only redacted preview + key_set flag
    const getRes = await ctx.get(`${CH}/${id}`);
    const got = (await getRes.json()) as Envelope<Record<string, unknown>>;
    expect(got.success).toBe(true);
    expect(got.data!['name']).toBe(name);
    expect(got.data!['status']).toBe(2);
    expect(got.data!['key']).toBe(''); // redacted
    expect(got.data!['key_set']).toBe(true);
    expect(JSON.stringify(got.data)).not.toContain('sk-fake-key');

    // appears in the list
    const list = (await (await ctx.get(`${CHS}/?compact=1&page=1&page_size=100`)).json()) as Envelope<{
      items: Array<{ id: string; name: string }>;
    }>;
    expect(list.data!.items.some((it) => (it.id ?? '').trim() === id)).toBe(true);

    // delete, then deleting again is an idempotent success (hard delete by id)
    const del = await ctx.delete(`${CH}/${id}`);
    expect(((await del.json()) as Envelope).success).toBe(true);
    const delAgain = await ctx.delete(`${CH}/${id}`);
    expect(((await delAgain.json()) as Envelope).success).toBe(true);
    id = '';
  } finally {
    if (id) await ctx.delete(`${CH}/${id}`).catch(() => {});
    await ctx.dispose();
  }
});

// RT-API-060 (P1) — channel identifier validation.
test(localizedTitle("【渠道与供应商管理 / API】 渠道标识校验：名称为空、名称重复及 JSON 格式错误", "channel identifier validation (empty name, duplicate name, malformed JSON)"), async () => {
  skipIfNoService();
  skipIfNoAdminKey();
  const ctx = await adminContext(baseURLFor('router')!);
  const name = `e2e-dup-${Date.now()}`;
  let id = '';
  try {
    // empty name
    const empty = await ctx.post(`${CH}/`, {
      data: { name: '', protocol: 'openai', key: 'sk', base_url: 'https://api.openai.com', status: 2, models: '' },
    });
    expect(((await empty.json()) as Envelope).message).toBe('渠道标识不能为空');

    // create then re-create the same name → duplicate rejected
    id = await createInertChannel(ctx, name);
    const dup = await ctx.post(`${CH}/`, {
      data: { name, protocol: 'openai', key: 'sk', base_url: 'https://api.openai.com', status: 2, models: '' },
    });
    const dupBody = (await dup.json()) as Envelope;
    expect(dupBody.success).toBe(false);
    expect(dupBody.message).toBe('渠道标识已存在');

    // malformed JSON body → HTTP 200 success:false with a parse-error message
    const malformed = await ctx.post(`${CH}/`, { headers: { 'content-type': 'application/json' }, data: '{ not json' });
    const mBody = (await malformed.json()) as Envelope;
    expect(mBody.success).toBe(false);
    expect(mBody.message ?? '').toMatch(/invalid character|cannot unmarshal/);
  } finally {
    if (id) await ctx.delete(`${CH}/${id}`).catch(() => {});
    await ctx.dispose();
  }
});

// RT-API-062 (P1) — channels list pagination + compact projection.
test(localizedTitle("【渠道与供应商管理 / API】 渠道列表支持分页和精简字段投影", "channels list supports pagination and a compact projection"), async () => {
  skipIfNoService();
  skipIfNoAdminKey();
  const ctx = await adminContext(baseURLFor('router')!);
  try {
    const full = (await (await ctx.get(`${CHS}/?page=1&page_size=2`)).json()) as Envelope<{
      items: Array<Record<string, unknown>>;
      total: number;
      page: number;
      page_size: number;
    }>;
    expect(full.success).toBe(true);
    expect(full.data!.page).toBe(1);
    expect(full.data!.page_size).toBe(2);
    expect(full.data!.items.length).toBeLessThanOrEqual(2);
    expect(typeof full.data!.total).toBe('number');
    // full item carries operational fields
    if (full.data!.items.length > 0) {
      const it = full.data!.items[0];
      for (const k of ['id', 'protocol', 'status', 'name', 'capabilities']) expect(it).toHaveProperty(k);
    }

    const compact = (await (await ctx.get(`${CHS}/?compact=1&page=1&page_size=2`)).json()) as Envelope<{
      items: Array<Record<string, unknown>>;
    }>;
    expect(compact.success).toBe(true);
    if (compact.data!.items.length > 0) {
      const it = compact.data!.items[0];
      // compact keeps exactly id/protocol/status/name — no billing/quota fields
      expect(Object.keys(it).sort()).toEqual(['id', 'name', 'protocol', 'status']);
    }
  } finally {
    await ctx.dispose();
  }
});

// RT-API-063 (P1) — test + refresh + sub-resource contracts on an inert channel.
test(localizedTitle("【渠道与供应商管理 / API】 渠道测试、刷新及子资源接口返回受控响应", "channel test/refresh/sub-resource endpoints return controlled contracts"), async () => {
  skipIfNoService();
  skipIfNoAdminKey();
  const ctx = await adminContext(baseURLFor('router')!);
  const name = `e2e-inert-${Date.now()}`;
  let id = '';
  try {
    id = await createInertChannel(ctx, name);

    // testing a channel with no models is a controlled refusal, not a crash /
    // not a real upstream call
    const tests = await ctx.post(`${CH}/${id}/tests`, { data: {} });
    const testsBody = (await tests.json()) as Envelope;
    expect(testsBody.success).toBe(false);
    expect(testsBody.message).toBe('未找到可用于测试的模型');

    // refresh with an unsupported action is rejected before any task is queued
    const refresh = await ctx.post(`${CH}/${id}/refresh`, { data: { action: 'bogus' } });
    const refreshBody = (await refresh.json()) as Envelope;
    expect(refreshBody.success).toBe(false);
    expect(refreshBody.message).toBe('不支持的刷新动作');

    // model list is an empty page for a fresh channel
    const models = (await (await ctx.get(`${CH}/${id}/models`)).json()) as Envelope<{
      items: unknown[];
      total: number;
      selected_count: number;
      active_count: number;
    }>;
    expect(models.success).toBe(true);
    expect(models.data!.items).toEqual([]);
    expect(models.data!.total).toBe(0);
    expect(models.data!.selected_count).toBe(0);

    // test history is empty with a zero last-tested marker
    const history = (await (await ctx.get(`${CH}/${id}/tests`)).json()) as Envelope<{
      items: unknown[];
      last_tested_at: number;
    }>;
    expect(history.success).toBe(true);
    expect(history.data!.items).toEqual([]);
    expect(history.data!.last_tested_at).toBe(0);
  } finally {
    if (id) await ctx.delete(`${CH}/${id}`).catch(() => {});
    await ctx.dispose();
  }
});

// RT-API-064 (P2) — get on a missing channel is a controlled not-found.
test(localizedTitle("【渠道与供应商管理 / API】 查询不存在的渠道时返回受控的未找到响应", "getting a non-existent channel returns a controlled not-found"), async () => {
  skipIfNoService();
  skipIfNoAdminKey();
  const ctx = await adminContext(baseURLFor('router')!);
  try {
    const res = await ctx.get(`${CH}/zzz-does-not-exist-000000`);
    const body = (await res.json()) as Envelope;
    expect(res.status()).toBe(200);
    expect(body.success).toBe(false);
    expect(body.message ?? '').toMatch(/record not found|不存在/);
  } finally {
    await ctx.dispose();
  }
});

// RT-API-065 (P1) — providers catalog list + missing provider.
test(localizedTitle("【渠道与供应商管理 / API】 供应商目录返回条目，并对不存在的供应商给出错误", "providers catalog lists entries and reports a missing provider"), async () => {
  skipIfNoService();
  skipIfNoAdminKey();
  const ctx = await adminContext(baseURLFor('router')!);
  try {
    const list = (await (await ctx.get(`${PROV}/?page=1&page_size=2`)).json()) as Envelope<{
      items: Array<{ id: string; name: string; models: string[] }>;
    }>;
    expect(list.success).toBe(true);
    expect(Array.isArray(list.data!.items)).toBe(true);
    if (list.data!.items.length > 0) {
      const p = list.data!.items[0];
      for (const k of ['id', 'name', 'models']) expect(p).toHaveProperty(k);
    }

    const missing = await ctx.get(`${PROV}/zzz-not-a-provider`);
    const missingBody = (await missing.json()) as Envelope;
    expect(missingBody.success).toBe(false);
    expect(missingBody.message).toBe('供应商不存在');
  } finally {
    await ctx.dispose();
  }
});

// RT-API-066 (P0) — admin authz boundary: normal user forbidden, no-auth 401.
test(localizedTitle("【渠道与供应商管理 / API】 渠道与供应商管理接口拒绝普通用户（200 权限不足）和未登录请求（401）", "channel/provider admin endpoints reject normal users (200 权限不足) and anonymous (401)"), async () => {
  skipIfNoService();
  skipIfNoUserKey();
  const userTokens = await acquireRouterToken(baseURLFor('router')!);
  const asUser = await apiContext(baseURLFor('router')!, { Authorization: `Bearer ${userTokens.token}` });
  const asAnon = await apiContext(baseURLFor('router')!);
  try {
    // normal (RoleCommonUser) token → HTTP 200 success:false 权限不足
    for (const path of [`${CHS}/`, `${PROV}/`]) {
      const res = await asUser.get(path);
      const body = (await res.json()) as Envelope;
      expect(res.status(), `user GET ${path}`).toBe(200);
      expect(body.success, `user GET ${path}`).toBe(false);
      expect(body.message ?? '', `user GET ${path}`).toContain('权限不足');
    }
    const postAsUser = await asUser.post(`${CH}/`, {
      data: { name: `e2e-forbidden-${Date.now()}`, protocol: 'openai', key: 'k', status: 2, models: '' },
    });
    expect(((await postAsUser.json()) as Envelope).message ?? '').toContain('权限不足');

    // no token at all → HTTP 401
    for (const path of [`${CHS}/`, `${PROV}/`]) {
      const res = await asAnon.get(path);
      expect(res.status(), `anon GET ${path}`).toBe(401);
    }
  } finally {
    await asUser.dispose();
    await asAnon.dispose();
  }
});
