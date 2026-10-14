/**
 * router — 个人供应商路由 (Personal Provider Routing), user-level BYOK.
 *
 * A "personal provider connection" is a normal user's own upstream (bring your
 * own key). It lives under `/api/v1/public/personal-provider/*` behind
 * `UserAuth` (RoleCommonUser) — no admin, no feature toggle; the default
 * routing policy is `personal_first`. Connections belong to exactly one
 * `user_id`, never enter the operator `channels` table, and are surfaced to
 * routing as synthetic channels with id `personal:<connectionId>`.
 *
 * Assertions pin the *live* contract (verified against the running service):
 *   - envelope `{success, message, data}`; most logical failures are HTTP 200
 *     with `success:false`; malformed JSON → 400; missing auth → 401.
 *   - the credential (`api_key`) is WRITE-ONLY: responses only ever expose
 *     `credential_configured` (bool), never the key.
 *   - Base URL is SSRF-guarded: HTTPS-only, public host only (localhost /
 *     private / userinfo / query / fragment rejected) — empty is allowed
 *     (protocol default endpoint).
 *   - protocol whitelist: openai/anthropic/gemini/ali/deepseek.
 *
 * NOTE (id quirk): connection ids come back as char36 padded with trailing
 * spaces (`"…ed    "`), so every id is `.trim()`-ed before use in a URL.
 *
 * Verified against router `internal/admin/controller/personalprovider/handler.go`,
 * `internal/admin/model/personal_provider.go`, `common/client/personal_provider.go`.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';
import { acquireRouterToken } from '../helpers/auth';

const PP = '/api/v1/public/personal-provider';
const CONNS = `${PP}/connections`;

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}
function skipIfNoKey() {
  test.skip(!envFor('router')['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');
}
/** A model guaranteed to be in this account's routable set once a connection lists it. */
function testModel(): string {
  return envFor('router')['ROUTER_PERSONAL_UPSTREAM_MODEL'] ?? 'gpt-4o-mini';
}

interface Envelope<T = unknown> {
  success?: boolean;
  message?: string;
  code?: string;
  data?: T;
}
interface Connection {
  id: string;
  name: string;
  protocol: string;
  base_url: string;
  models: string[];
  priority: number;
  status: number;
  credential_configured: boolean;
  created_at: number;
  updated_at: number;
}

async function authedContext(baseURL: string) {
  const { token } = await acquireRouterToken(baseURL);
  return apiContext(baseURL, { Authorization: `Bearer ${token}` });
}

// RT-API-049 (P0) — connection CRUD round-trip; credential never leaks.
test(localizedTitle("【模型中继与个人供应商 / API】 个人提供商连接 CRUD 往返； api_key 是只写的", "personal provider connection CRUD round-trip; api_key is write-only"), async () => {
  skipIfNoService();
  skipIfNoKey();
  const ctx = await authedContext(baseURLFor('router')!);
  const model = testModel();
  let id = '';
  try {
    // create
    const name = `e2e-crud-${Date.now()}`;
    const createRes = await ctx.post(CONNS, {
      data: { name, protocol: 'openai', base_url: '', api_key: 'sk-secret-value', models: [model], priority: 7, status: 1 },
    });
    expect(createRes.status()).toBe(200);
    const created = (await createRes.json()) as Envelope<Connection>;
    expect(created.success).toBe(true);
    id = (created.data!.id ?? '').trim();
    expect(id).not.toBe('');
    expect(created.data!.name).toBe(name);
    expect(created.data!.credential_configured).toBe(true);
    // the raw key must never be echoed anywhere in the payload
    expect(JSON.stringify(created.data)).not.toContain('sk-secret-value');
    expect(created.data).not.toHaveProperty('api_key');
    expect(created.data).not.toHaveProperty('key');

    // list contains it
    const listRes = await ctx.get(CONNS);
    const list = (await listRes.json()) as Envelope<Connection[]>;
    expect(list.success).toBe(true);
    expect(Array.isArray(list.data)).toBe(true);
    expect(list.data!.some((c) => (c.id ?? '').trim() === id)).toBe(true);
    expect(JSON.stringify(list.data)).not.toContain('sk-secret-value');

    // get one
    const getRes = await ctx.get(`${CONNS}/${id}`);
    const got = (await getRes.json()) as Envelope<Connection>;
    expect(got.success).toBe(true);
    expect((got.data!.id ?? '').trim()).toBe(id);
    expect(got.data!.credential_configured).toBe(true);

    // update: rename + change priority, keep credential (empty api_key)
    const newName = `${name}-renamed`;
    const putRes = await ctx.put(`${CONNS}/${id}`, {
      data: { name: newName, protocol: 'openai', base_url: '', api_key: '', models: [model], priority: 3, status: 0 },
    });
    const put = (await putRes.json()) as Envelope<Connection>;
    expect(put.success).toBe(true);
    expect(put.data!.name).toBe(newName);
    expect(put.data!.priority).toBe(3);
    expect(put.data!.credential_configured).toBe(true); // empty key kept the old one
    expect(put.data!.status).toBe(1); // status:0 keeps the existing enabled state

    // delete
    const delRes = await ctx.delete(`${CONNS}/${id}`);
    expect(((await delRes.json()) as Envelope).success).toBe(true);
    id = '';

    // gone
    const goneRes = await ctx.get(`${CONNS}/${id || 'deleted'}`);
    // deleting cleared id; re-fetch the (now missing) one we just removed
    const afterList = (await (await ctx.get(CONNS)).json()) as Envelope<Connection[]>;
    expect(afterList.data!.some((c) => (c.name ?? '') === newName)).toBe(false);
    expect(goneRes.status()).toBe(200);
  } finally {
    if (id) await ctx.delete(`${CONNS}/${id}`).catch(() => {});
    await ctx.dispose();
  }
});

// RT-API-050 (P1) — api_key rules: required on create, kept on empty update.
test(localizedTitle("【模型中继与个人供应商 / API】 创建需要 api_key；确切的消息是「API Key 不能为空」", "create requires an api_key; the exact message is 「API Key 不能为空」"), async () => {
  skipIfNoService();
  skipIfNoKey();
  const ctx = await authedContext(baseURLFor('router')!);
  try {
    const res = await ctx.post(CONNS, {
      data: { name: `e2e-nokey-${Date.now()}`, protocol: 'openai', base_url: '', api_key: '', models: [testModel()], status: 1 },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Envelope;
    expect(body.success).toBe(false);
    expect(body.message).toBe('API Key 不能为空');
  } finally {
    await ctx.dispose();
  }
});

// RT-API-051 (P0) — Base URL SSRF guard. Each rejection asserts its exact
// Chinese message so a generic failure can't be mistaken for the guard firing.
test(localizedTitle("【模型中继与个人供应商 / API】 基类 URL SSRF 防护拒绝非 HTTPS / localhost / private / userinfo / query /fragment", "Base URL SSRF guard rejects non-HTTPS / localhost / private / userinfo / query / fragment"), async () => {
  skipIfNoService();
  skipIfNoKey();
  const ctx = await authedContext(baseURLFor('router')!);
  const model = testModel();
  const base = (baseUrl: string) => ({
    name: `e2e-ssrf-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    protocol: 'openai',
    base_url: baseUrl,
    api_key: 'sk-x',
    models: [model],
    status: 1,
  });
  const cases: Array<{ url: string; expect: RegExp }> = [
    { url: 'http://example.com', expect: /仅支持 HTTPS/ },
    { url: 'https://localhost:8443', expect: /不允许使用 localhost/ },
    { url: 'https://127.0.0.1', expect: /内网|保留|localhost/ },
    { url: 'https://10.0.0.1', expect: /内网|保留/ },
    { url: 'https://user:pass@example.com', expect: /不允许包含用户信息/ },
    { url: 'https://example.com/v1?foo=bar', expect: /不允许包含查询参数/ },
    { url: 'https://example.com/v1#frag', expect: /不允许包含片段/ },
  ];
  try {
    for (const c of cases) {
      const res = await ctx.post(CONNS, { data: base(c.url) });
      expect(res.status(), `url=${c.url}`).toBe(200);
      const body = (await res.json()) as Envelope;
      expect(body.success, `url=${c.url} should be rejected`).toBe(false);
      expect(body.message ?? '', `url=${c.url}`).toMatch(c.expect);
      // rejected before any upstream contact — nothing was created
    }
  } finally {
    await ctx.dispose();
  }
});

// RT-API-052 (P1) — protocol whitelist (openai/anthropic/gemini/ali/deepseek).
test(localizedTitle("【模型中继与个人供应商 / API】 协议白名单接受已知协议并拒绝未知协议", "protocol whitelist accepts known protocols and rejects unknown ones"), async () => {
  skipIfNoService();
  skipIfNoKey();
  const ctx = await authedContext(baseURLFor('router')!);
  const model = testModel();
  const created: string[] = [];
  try {
    for (const protocol of ['openai', 'anthropic', 'gemini', 'ali', 'deepseek']) {
      const res = await ctx.post(CONNS, {
        data: { name: `e2e-proto-${protocol}-${Date.now()}`, protocol, base_url: '', api_key: 'sk-x', models: [model], status: 1 },
      });
      const body = (await res.json()) as Envelope<Connection>;
      expect(body.success, `protocol ${protocol} should be accepted`).toBe(true);
      created.push((body.data!.id ?? '').trim());
    }
    const bad = await ctx.post(CONNS, {
      data: { name: `e2e-proto-bad-${Date.now()}`, protocol: 'bogus', base_url: '', api_key: 'sk-x', models: [model], status: 1 },
    });
    const badBody = (await bad.json()) as Envelope;
    expect(badBody.success).toBe(false);
    expect(badBody.message).toBe('个人供应商协议不受支持');
  } finally {
    for (const id of created) if (id) await ctx.delete(`${CONNS}/${id}`).catch(() => {});
    await ctx.dispose();
  }
});

// RT-API-053 (P1) — field validation: name / models / malformed JSON.
test(localizedTitle("【模型中继与个人供应商 / API】 连接字段验证（空名称、无模型、格式错误 JSON）", "connection field validation (empty name, no models, malformed JSON)"), async () => {
  skipIfNoService();
  skipIfNoKey();
  const ctx = await authedContext(baseURLFor('router')!);
  const model = testModel();
  try {
    const noName = await ctx.post(CONNS, {
      data: { name: '   ', protocol: 'openai', base_url: '', api_key: 'sk-x', models: [model], status: 1 },
    });
    expect(((await noName.json()) as Envelope).message).toBe('连接名称不能为空');

    const noModels = await ctx.post(CONNS, {
      data: { name: `e2e-nomodel-${Date.now()}`, protocol: 'openai', base_url: '', api_key: 'sk-x', models: [], status: 1 },
    });
    expect(((await noModels.json()) as Envelope).message).toBe('至少选择一个模型');

    // malformed JSON body → HTTP 400 「请求格式无效」
    const malformed = await ctx.post(CONNS, {
      headers: { 'content-type': 'application/json' },
      data: '{ not valid json',
    });
    expect(malformed.status()).toBe(400);
    expect(((await malformed.json()) as Envelope).message).toBe('请求格式无效');
  } finally {
    await ctx.dispose();
  }
});

// RT-API-054 (P1) — model routes upsert/list/delete + policy & scope gates.
test(localizedTitle("【模型中继与个人供应商 / API】 具有策略和范围验证的模型路由 upsert/list/delete", "model-route upsert/list/delete with policy and scope validation"), async () => {
  skipIfNoService();
  skipIfNoKey();
  const ctx = await authedContext(baseURLFor('router')!);
  const model = testModel();
  let connId = '';
  try {
    // a connection listing the model makes it routable for this account
    const c = await ctx.post(CONNS, {
      data: { name: `e2e-route-${Date.now()}`, protocol: 'openai', base_url: '', api_key: 'sk-x', models: [model], status: 1 },
    });
    connId = (((await c.json()) as Envelope<Connection>).data!.id ?? '').trim();

    // valid upsert
    const ok = await ctx.put(`${PP}/model-routes`, { data: { model, route_policy: 'personal_only' } });
    expect(((await ok.json()) as Envelope).success).toBe(true);

    // invalid policy
    const badPolicy = await ctx.put(`${PP}/model-routes`, { data: { model, route_policy: 'bogus' } });
    expect(((await badPolicy.json()) as Envelope).message).toBe('路由策略无效');

    // model outside the routable set
    const outOfScope = await ctx.put(`${PP}/model-routes`, { data: { model: 'zzz-not-a-real-model', route_policy: 'personal_first' } });
    expect(((await outOfScope.json()) as Envelope).message).toBe('模型不在当前账号可用范围内');

    // list reflects the rule
    const list = (await (await ctx.get(`${PP}/model-routes`)).json()) as Envelope<Array<{ model: string; route_policy: string }>>;
    expect(list.success).toBe(true);
    expect(list.data!.some((r) => r.model === model && r.route_policy === 'personal_only')).toBe(true);

    // delete the rule, then deleting again is a controlled not-found
    const del = await ctx.delete(`${PP}/model-routes/${encodeURIComponent(model)}`);
    expect(((await del.json()) as Envelope).success).toBe(true);
    const delMissing = await ctx.delete(`${PP}/model-routes/${encodeURIComponent(model)}`);
    const missingBody = (await delMissing.json()) as Envelope;
    expect(missingBody.success).toBe(false);
    expect(missingBody.code).toBe('personal_model_route_not_found');
    expect(missingBody.message).toBe('模型路由规则不存在或无权访问');
  } finally {
    if (connId) await ctx.delete(`${CONNS}/${connId}`).catch(() => {});
    await ctx.dispose();
  }
});

// RT-API-055 (P2) — routing-quota shape (unlimited request-metered).
test(localizedTitle("【模型中继与个人供应商 / API】 路由配额返回无限请求计量形状", "routing-quota returns the unlimited request-metered shape"), async () => {
  skipIfNoService();
  skipIfNoKey();
  const ctx = await authedContext(baseURLFor('router')!);
  try {
    const res = await ctx.get(`${PP}/routing-quota`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Envelope<{
      period: string;
      used_requests: number;
      included_requests: number;
      unlimited: boolean;
      unit: string;
    }>;
    expect(body.success).toBe(true);
    expect(body.data!.unit).toBe('request');
    expect(body.data!.unlimited).toBe(true);
    expect(body.data!.period).toMatch(/^\d{4}-\d{2}$/);
    expect(typeof body.data!.used_requests).toBe('number');
  } finally {
    await ctx.dispose();
  }
});

// RT-API-056 (P1) — ownership isolation: a missing/foreign id is a controlled
// not-found, never a leak or a 5xx.
test(localizedTitle("【模型中继与个人供应商 / API】 对不存在的连接进行操作返回 personal_provider_not_found", "operating on a non-existent connection returns personal_provider_not_found"), async () => {
  skipIfNoService();
  skipIfNoKey();
  const ctx = await authedContext(baseURLFor('router')!);
  try {
    for (const op of ['get', 'put', 'delete'] as const) {
      const path = `${CONNS}/nonexistent-000000000000000000000000`;
      const res =
        op === 'get'
          ? await ctx.get(path)
          : op === 'delete'
            ? await ctx.delete(path)
            : await ctx.put(path, { data: { name: 'x', protocol: 'openai', base_url: '', api_key: 'sk-x', models: [testModel()], status: 1 } });
      const body = (await res.json()) as Envelope;
      expect(body.success, `op=${op}`).toBe(false);
      expect(body.code, `op=${op}`).toBe('personal_provider_not_found');
      expect(body.message, `op=${op}`).toBe('个人供应商连接不存在或无权访问');
    }
  } finally {
    await ctx.dispose();
  }
});

// RT-API-057 (P1) — the whole group requires auth.
test(localizedTitle("【模型中继与个人供应商 / API】 个人提供商端点拒绝未经身份验证的请求 401", "personal-provider endpoints reject unauthenticated requests with 401"), async () => {
  skipIfNoService();
  const ctx = await apiContext(baseURLFor('router')!);
  try {
    for (const path of [`${CONNS}`, `${PP}/model-routes`, `${PP}/routing-quota`]) {
      const res = await ctx.get(path);
      expect(res.status(), `GET ${path}`).toBe(401);
    }
  } finally {
    await ctx.dispose();
  }
});
