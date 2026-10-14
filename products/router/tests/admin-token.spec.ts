/**
 * router — 管理员站点级令牌管理 (admin site-wide token administration).
 *
 * The operator-level token endpoints under `/api/v1/admin/token/*` let an admin
 * list / read / search / update / delete ANY user's API token — distinct from
 * the user-scoped `/api/v1/public/token/*` where a caller only ever sees their
 * own. This suite proves the admin surface across a token that a *normal* user
 * owns:
 *
 *   - list carries the owner identity (`presenter.AdminToken.username`) + a
 *     `meta:{total,page,page_size}` page; keyword filter finds the token.
 *   - get-by-id returns the plain `presenter.Token` (no username);
 *   - `search` matches on name/id;
 *   - update supports a `?status_only` partial write (flip status without
 *     clobbering the other fields) and a full-field update (rename);
 *   - delete removes it, after which get / delete report the localized
 *     not-found `令牌不存在或无权访问` with `code:"token_not_found"`;
 *   - the admin group is gated: a RoleCommonUser is refused 200「权限不足」and
 *     an anonymous caller gets 401.
 *
 * The subject token is created through the user endpoint (there is no admin
 * *create*). That create is entitlement-gated on the owner account, so when the
 * account has no available models the whole suite skips cleanly rather than
 * faking a pass.
 *
 * Envelope pinned live: `{success, message, data}` (+`meta` on list, +`code` on
 * some token errors). HTTP status is always 200; assertions key off `success`.
 * Ids come back char36 space-padded → always `.trim()`.
 *
 * Requires `ROUTER_ADMIN_PRIVATE_KEY` (a wallet in the deployment's
 * `bootstrap.root_wallet_address`) and `ROUTER_WALLET_PRIVATE_KEY` (the normal
 * owner account). Verified against router
 * `internal/admin/controller/token/admin_handler.go`, `handler.go`,
 * `internal/transport/http/router/api.go`.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';
import { acquireRouterToken, acquireAdminToken } from '../helpers/auth';

const ADMIN_TOKEN = '/api/v1/admin/token';   // admin, site-wide
const USER_TOKEN = '/api/v1/public/token';   // user, own-only (create/cleanup)
const PP_CONNS = '/api/v1/public/personal-provider/connections'; // BYOK fallback (gives the owner a model)
const USER_MODELS = '/api/v1/public/user/models/available'; // account's available-model set (entitlement ∪ BYOK)

// model.Token statuses (internal/admin/model/token.go): 1=Enabled 2=Disabled.
const TOKEN_ENABLED = 1;
const TOKEN_DISABLED = 2;

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
  code?: string;
  data?: T;
  meta?: { total?: number; page?: number; page_size?: number };
}

interface TokenRow {
  id?: string;
  user_id?: string;
  name?: string;
  status?: number;
  key?: string;
  username?: string; // only on AdminToken (list)
}

async function adminContext(baseURL: string) {
  const { token } = await acquireAdminToken(baseURL);
  return apiContext(baseURL, { Authorization: `Bearer ${token}` });
}

/** The upstream model used for the BYOK fallback (already configured for module 十一). */
function testModel(): string {
  return envFor('router')['ROUTER_PERSONAL_UPSTREAM_MODEL'] ?? 'gpt-4o-mini';
}

interface CreatedToken {
  id: string;
  ctx: Awaited<ReturnType<typeof adminContext>>; // the owner's user context
  cleanupConnId?: string; // a BYOK connection to remove in finally, if the fallback was used
}

/**
 * Create a token owned by the normal user via the user endpoint.
 *
 * Token creation is entitlement-gated: the owner must have at least one
 * available model, which comes from an active package / top-up batch OR a
 * personal-provider (BYOK) connection. We try the plain create first (real
 * entitlement path — works once the account has a package or granted balance);
 * if that account has no available model we self-provision an enabled BYOK
 * connection carrying one model and retry, so the case still runs for real
 * instead of skipping. The connection is reported back for cleanup.
 *
 * Returns the trimmed id (+ owner ctx + optional connection id to clean up), or
 * `{id:null}` when neither path yields a model (a genuine environment gap).
 */
async function createUserToken(
  baseURL: string,
  name: string,
): Promise<CreatedToken | { id: null; reason: string }> {
  const { token } = await acquireRouterToken(baseURL);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  const body = { name, unlimited_quota: true, unlimited_request_count: true, expired_time: -1, models: '' };

  // 1. Real entitlement path (active package / granted balance).
  const first = (await (await ctx.post(`${USER_TOKEN}/`, { data: body })).json()) as Envelope<TokenRow>;
  if (first.success && first.data?.id) {
    return { id: (first.data.id ?? '').trim(), ctx };
  }
  // Only the "no available model" gate is worth working around; anything else is a hard failure.
  if (!/暂无可用模型/.test(first.message ?? '')) {
    await ctx.dispose();
    return { id: null, reason: first.message ?? 'token create failed' };
  }

  // 2. BYOK fallback: self-provision an enabled connection with one model.
  const connName = `e2e-tokdep-${Date.now().toString(36)}`;
  const connRes = (await (
    await ctx.post(PP_CONNS, {
      data: { name: connName, protocol: 'openai', base_url: '', api_key: 'sk-x', models: [testModel()], status: 1 },
    })
  ).json()) as Envelope<{ id: string }>;
  if (!connRes.success || !connRes.data?.id) {
    await ctx.dispose();
    return { id: null, reason: `no entitlement and BYOK fallback failed: ${connRes.message}` };
  }
  const cleanupConnId = (connRes.data.id ?? '').trim();

  const second = (await (await ctx.post(`${USER_TOKEN}/`, { data: body })).json()) as Envelope<TokenRow>;
  if (second.success && second.data?.id) {
    return { id: (second.data.id ?? '').trim(), ctx, cleanupConnId };
  }
  await ctx.delete(`${PP_CONNS}/${cleanupConnId}`).catch(() => {});
  await ctx.dispose();
  return { id: null, reason: second.message ?? 'token create failed after BYOK fallback' };
}

// RT-API-069 (P0) — admin lists any user's token with owner identity; get-by-id + search.
test(localizedTitle("【管理员令牌管理 / API】 admin 列出带有所有者用户名的用户令牌，通过 id 读取它，并通过搜索找到它", "admin lists a user token with owner username, reads it by id, and finds it by search"), async () => {
  skipIfNoService();
  skipIfNoAdminKey();
  skipIfNoUserKey();
  const baseURL = baseURLFor('router')!;
  const name = `e2e-tok69-${Date.now().toString(36)}`;
  const created = await createUserToken(baseURL, name);
  test.skip(created.id === null, `owner cannot create a token: ${(created as { reason?: string }).reason}`);
  const owned = created as CreatedToken;
  const { id, ctx: userCtx } = owned;
  const admin = await adminContext(baseURL);
  try {
    // list (keyword-filtered) → carries the owner identity + a page meta
    const listRes = await admin.get(`${ADMIN_TOKEN}/?keyword=${encodeURIComponent(name)}&page=1&page_size=100`);
    const list = (await listRes.json()) as Envelope<TokenRow[]>;
    expect(list.success, list.message).toBe(true);
    expect(Array.isArray(list.data)).toBe(true);
    const mine = (list.data ?? []).find((t) => (t.id ?? '').trim() === id);
    expect(mine, 'the user-owned token appears in the admin site-wide list').toBeTruthy();
    // AdminToken adds the resolved owner `username` (empty string allowed, but present)
    expect(mine!).toHaveProperty('username');
    expect(mine!).toHaveProperty('user_id');
    expect(mine!.status).toBe(TOKEN_ENABLED);
    // page meta is present on the list envelope
    expect(typeof list.meta?.total).toBe('number');
    expect(list.meta?.page).toBe(1);

    // get-by-id → plain presenter.Token (no username field)
    const getRes = await admin.get(`${ADMIN_TOKEN}/${id}`);
    const got = (await getRes.json()) as Envelope<TokenRow>;
    expect(got.success, got.message).toBe(true);
    expect((got.data?.id ?? '').trim()).toBe(id);
    expect(got.data?.name).toBe(name);

    // search → matches on name (limit 50, newest first)
    const searchRes = await admin.get(`${ADMIN_TOKEN}/search?keyword=${encodeURIComponent(name)}`);
    const search = (await searchRes.json()) as Envelope<TokenRow[]>;
    expect(search.success, search.message).toBe(true);
    expect((search.data ?? []).some((t) => (t.id ?? '').trim() === id)).toBe(true);
  } finally {
    await admin.delete(`${ADMIN_TOKEN}/${id}`).catch(() => {});
    if (owned.cleanupConnId) await userCtx.delete(`${PP_CONNS}/${owned.cleanupConnId}`).catch(() => {});
    await admin.dispose();
    await userCtx.dispose();
  }
});

// RT-API-070 (P0) — admin status_only partial update, then full-field rename.
test(localizedTitle("【管理员令牌管理 / API】 admin status_only 更新翻转状态而不破坏字段；完整更新重命名", "admin status_only update flips status without clobbering fields; full update renames"), async () => {
  skipIfNoService();
  skipIfNoAdminKey();
  skipIfNoUserKey();
  const baseURL = baseURLFor('router')!;
  const name = `e2e-tok70-${Date.now().toString(36)}`;
  const created = await createUserToken(baseURL, name);
  test.skip(created.id === null, `owner cannot create a token: ${(created as { reason?: string }).reason}`);
  const owned = created as CreatedToken;
  const { id, ctx: userCtx } = owned;
  const admin = await adminContext(baseURL);
  try {
    // 1. status_only: disable — only status changes, name is preserved
    const disable = await admin.put(`${ADMIN_TOKEN}/?status_only=1`, { data: { id, status: TOKEN_DISABLED } });
    const disableBody = (await disable.json()) as Envelope<TokenRow>;
    expect(disableBody.success, disableBody.message).toBe(true);
    const afterDisable = (await (await admin.get(`${ADMIN_TOKEN}/${id}`)).json()) as Envelope<TokenRow>;
    expect(afterDisable.data?.status).toBe(TOKEN_DISABLED);
    expect(afterDisable.data?.name).toBe(name); // untouched by the status-only write

    // 2. full update: rename only (does NOT touch status — the full-field branch in
    //    UpdateAdminToken only writes Name/ExpiredTime/Remain*/Unlimited*/Models/RoutePolicy/Subnet
    //    when ?status_only is empty; status changes must go through ?status_only).
    const newName = `${name}-r`;
    const full = await admin.put(`${ADMIN_TOKEN}/`, {
      data: {
        id,
        name: newName,
        status: TOKEN_DISABLED, // present in the body, but ignored by the full-field branch
        unlimited_quota: true,
        unlimited_request_count: true,
        expired_time: -1,
        models: '',
      },
    });
    const fullBody = (await full.json()) as Envelope<TokenRow>;
    expect(fullBody.success, fullBody.message).toBe(true);
    const afterFull = (await (await admin.get(`${ADMIN_TOKEN}/${id}`)).json()) as Envelope<TokenRow>;
    expect(afterFull.data?.name).toBe(newName);
    expect(afterFull.data?.status).toBe(TOKEN_DISABLED); // unchanged by full-field update

    // 3. status_only: re-enable — same partial-write path as #1, opposite direction
    const enable = await admin.put(`${ADMIN_TOKEN}/?status_only=1`, { data: { id, status: TOKEN_ENABLED } });
    const enableBody = (await enable.json()) as Envelope<TokenRow>;
    expect(enableBody.success, enableBody.message).toBe(true);
    const afterEnable = (await (await admin.get(`${ADMIN_TOKEN}/${id}`)).json()) as Envelope<TokenRow>;
    expect(afterEnable.data?.status).toBe(TOKEN_ENABLED);
    expect(afterEnable.data?.name).toBe(newName); // name from step 2 preserved by the status-only write
  } finally {
    await admin.delete(`${ADMIN_TOKEN}/${id}`).catch(() => {});
    if (owned.cleanupConnId) await userCtx.delete(`${PP_CONNS}/${owned.cleanupConnId}`).catch(() => {});
    await admin.dispose();
    await userCtx.dispose();
  }
});

// RT-API-071 (P0) — admin delete, then not-found on re-read / re-delete.
test(localizedTitle("【管理员令牌管理 / API】 管理员删除删除令牌；重新读取并重新删除报告token_not_found", "admin delete removes the token; re-read and re-delete report token_not_found"), async () => {
  skipIfNoService();
  skipIfNoAdminKey();
  skipIfNoUserKey();
  const baseURL = baseURLFor('router')!;
  const name = `e2e-tok71-${Date.now().toString(36)}`;
  const created = await createUserToken(baseURL, name);
  test.skip(created.id === null, `owner cannot create a token: ${(created as { reason?: string }).reason}`);
  const owned = created as CreatedToken;
  const { id, ctx: userCtx } = owned;
  const admin = await adminContext(baseURL);
  try {
    const del = await admin.delete(`${ADMIN_TOKEN}/${id}`);
    expect(((await del.json()) as Envelope).success).toBe(true);

    // re-read → localized not-found with the token_not_found code
    const reread = (await (await admin.get(`${ADMIN_TOKEN}/${id}`)).json()) as Envelope;
    expect(reread.success).toBe(false);
    expect(reread.message).toBe('令牌不存在或无权访问');
    expect(reread.code).toBe('token_not_found');

    // delete again → same controlled not-found (not an idempotent success)
    const delAgain = (await (await admin.delete(`${ADMIN_TOKEN}/${id}`)).json()) as Envelope;
    expect(delAgain.success).toBe(false);
    expect(delAgain.message).toBe('令牌不存在或无权访问');
    expect(delAgain.code).toBe('token_not_found');
  } finally {
    await admin.delete(`${ADMIN_TOKEN}/${id}`).catch(() => {});
    if (owned.cleanupConnId) await userCtx.delete(`${PP_CONNS}/${owned.cleanupConnId}`).catch(() => {});
    await admin.dispose();
    await userCtx.dispose();
  }
});

// RT-API-072 (P0) — admin token endpoints reject normal users (200 权限不足) and anonymous (401).
test(localizedTitle("【管理员令牌管理 / API】 管理令牌端点拒绝普通用户（权限不足）和匿名用户（401）", "admin token endpoints reject a normal user (200 权限不足) and anonymous (401)"), async () => {
  skipIfNoService();
  skipIfNoUserKey();
  const baseURL = baseURLFor('router')!;
  const userTokens = await acquireRouterToken(baseURL);
  const asUser = await apiContext(baseURL, { Authorization: `Bearer ${userTokens.token}` });
  const asAnon = await apiContext(baseURL);
  try {
    // RoleCommonUser → HTTP 200 success:false 权限不足
    const userRes = await asUser.get(`${ADMIN_TOKEN}/`);
    const userBody = (await userRes.json()) as Envelope;
    expect(userRes.status()).toBe(200);
    expect(userBody.success).toBe(false);
    expect(userBody.message ?? '').toContain('权限不足');

    // no token at all → HTTP 401
    const anonRes = await asAnon.get(`${ADMIN_TOKEN}/`);
    expect(anonRes.status()).toBe(401);
  } finally {
    await asUser.dispose();
    await asAnon.dispose();
  }
});

// RT-API-078 (P0) — BYOK self-provision independently unlocks token creation.
//
// Token creation is entitlement-gated on the owner: available models =
// BuildUserEntitlementModels(user) ∪ ListPersonalProviderModels(user). RT-069..071
// exercise the real package/top-up entitlement path (both accounts now carry granted
// quota). This case proves the OTHER source in isolation — a personal-provider (BYOK)
// connection — regardless of whatever real entitlement the account also has:
//
//   - create an enabled BYOK connection carrying a UNIQUE synthetic model name;
//   - `GET /models/available?provider=personal_provider` isolates the BYOK-sourced
//     models (server filters on SourceType==personal_provider) and must contain the
//     synthetic model → the connection reached the account's available-model set;
//   - creating a user token scoped to EXACTLY that synthetic model succeeds, which can
//     only pass if the BYOK model satisfies validateTokenModelEntitlement → BYOK alone
//     unlocked token creation, independent of package/top-up entitlement.
//
// The synthetic model name never collides with a real catalog model, so the isolation
// is exact and there is zero routing blast radius (the connection points at no real
// upstream and the token is deleted in finally).
test(localizedTitle("【管理员令牌管理 / API】 BYOK 连接将其模型放入帐户集中并独立解锁令牌创建", "a BYOK connection puts its model into the account set and independently unlocks token creation"), async () => {
  skipIfNoService();
  skipIfNoUserKey();
  const baseURL = baseURLFor('router')!;
  const stamp = Date.now().toString(36);
  const byokModel = `e2e-byok-model-${stamp}`;
  const { token } = await acquireRouterToken(baseURL);
  const userCtx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  let connId = '';
  let tokenId = '';
  try {
    // 1. enabled BYOK connection carrying the unique synthetic model
    const connRes = (await (
      await userCtx.post(PP_CONNS, {
        data: { name: `e2e-byok-${stamp}`, protocol: 'openai', base_url: '', api_key: 'sk-x', models: [byokModel], status: 1 },
      })
    ).json()) as Envelope<{ id: string }>;
    expect(connRes.success, connRes.message).toBe(true);
    connId = (connRes.data?.id ?? '').trim();
    expect(connId).not.toBe('');

    // 2. the BYOK model shows up in the account's available set, isolated to the personal-provider source
    const availRes = (await (
      await userCtx.get(`${USER_MODELS}?provider=personal_provider`)
    ).json()) as Envelope<string[]>;
    expect(availRes.success, availRes.message).toBe(true);
    expect(availRes.data ?? [], 'BYOK-sourced models').toContain(byokModel);

    // 3. a token scoped to EXACTLY the BYOK model is created — only possible if BYOK
    //    alone satisfies the entitlement gate
    const tokRes = (await (
      await userCtx.post(`${USER_TOKEN}/`, {
        data: {
          name: `e2e-tok78-${stamp}`,
          unlimited_quota: true,
          unlimited_request_count: true,
          expired_time: -1,
          models: byokModel,
        },
      })
    ).json()) as Envelope<TokenRow>;
    expect(tokRes.success, tokRes.message).toBe(true);
    tokenId = (tokRes.data?.id ?? '').trim();
    expect(tokenId).not.toBe('');
  } finally {
    if (tokenId) await userCtx.delete(`${USER_TOKEN}/${tokenId}`).catch(() => {});
    if (connId) await userCtx.delete(`${PP_CONNS}/${connId}`).catch(() => {});
    await userCtx.dispose();
  }
});
