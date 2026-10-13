/**
 * router — 渠道账务人工采购快照 (channel billing manual purchase snapshots), admin.
 *
 * A snapshot records an operator's manual purchase/entitlement for a channel
 * (`event_type` purchase/renewal/upgrade/…, a set of quota/balance items and a
 * validity window). CRUD lives under `/api/v1/admin/channel/:id/billing/...`,
 * gated by `AdminAuth`. This suite drives a create→list→update→delete round-trip
 * plus the request validation and channel-not-found contracts.
 *
 * Blast-radius discipline mirrors admin-channels.spec: the parent channel is
 * created inert (`status:2` — never routed, no upstream contact) and both the
 * snapshot and the channel are removed in `finally`. Snapshots are pure billing
 * bookkeeping rows scoped to that throwaway channel, so they never touch live
 * routing or another channel's ledger.
 *
 * Contract notes pinned from the Go handlers (billing_resource.go):
 *   - envelope `{success, message, data}`, HTTP always 200.
 *   - CREATE returns only `data:{channel_id}` (NOT the new snapshot id) — the
 *     new id must be read back from the list, which returns `{items,total}`.
 *   - UPDATE / DELETE return `data:{channel_id, snapshot_id}`.
 *   - a missing channel surfaces the raw gorm message `record not found`
 *     (English — the repo returns gorm's error unwrapped).
 *   - validation strings: 采购币种不能为空 / 实付金额必须大于 0 / 请至少填写一条权益项.
 *
 * The `/admin/channel` group's auth boundary (normal user 200「权限不足」,
 * anon 401) is already covered by RT-API-066 (admin-channels.spec) — snapshots
 * share that exact group + middleware, so it is not re-asserted here.
 *
 * Requires `ROUTER_ADMIN_PRIVATE_KEY`. Verified against router
 * `internal/admin/controller/channel/billing_resource.go`,
 * `internal/admin/model/channel_billing.go`,
 * `internal/transport/http/router/api.go`.
 */
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';
import { acquireAdminToken } from '../helpers/auth';

const CH = '/api/v1/admin/channel';

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}
function skipIfNoAdminKey() {
  test.skip(!envFor('router')['ROUTER_ADMIN_PRIVATE_KEY'], 'ROUTER_ADMIN_PRIVATE_KEY not configured');
}

interface Envelope<T = unknown> {
  success?: boolean;
  message?: string;
  data?: T;
}

interface SnapshotRow {
  id?: string;
  channel_id?: string;
  source_type?: string;
  entitlement_name?: string;
  purchase_amount?: number;
  message?: string;
}

async function adminContext(baseURL: string) {
  const { token } = await acquireAdminToken(baseURL);
  return apiContext(baseURL, { Authorization: `Bearer ${token}` });
}

async function createInertChannel(ctx: Awaited<ReturnType<typeof adminContext>>, name: string): Promise<string> {
  const res = await ctx.post(`${CH}/`, {
    data: { name, protocol: 'openai', key: 'sk-fake-key', base_url: 'https://api.openai.com', status: 2, models: '' },
  });
  const body = (await res.json()) as Envelope<{ id: string }>;
  expect(body.success, `create channel ${name}: ${body.message}`).toBe(true);
  return (body.data!.id ?? '').trim();
}

/** A minimally-valid manual purchase snapshot request. */
function snapshotRequest(overrides: Record<string, unknown> = {}) {
  return {
    purchase_currency: 'USD',
    purchase_amount: 10,
    purchase_fx_rate: 7.2,
    purchase_cost_amount: 72,
    entitlement_name: 'e2e-plan',
    event_type: 'purchase',
    valid_from: 0,
    valid_until: 0,
    items: [{ resource_type: 'balance', amount: 72, currency: 'CNY' }],
    message: 'e2e snapshot',
    ...overrides,
  };
}

// RT-API-073 (P0) — snapshot create → list → update → delete round-trip.
test("【渠道账务与告警管理 / API】 管理员渠道账务快照创建、列表、更新、删除闭环", async () => {
  skipIfNoService();
  skipIfNoAdminKey();
  const ctx = await adminContext(baseURLFor('router')!);
  const name = `e2e-snap-${Date.now()}`;
  let channelId = '';
  let snapshotId = '';
  try {
    channelId = await createInertChannel(ctx, name);

    // CREATE → data carries only the channel id
    const createRes = await ctx.post(`${CH}/${channelId}/billing/snapshots`, { data: snapshotRequest() });
    const createBody = (await createRes.json()) as Envelope<{ channel_id: string }>;
    expect(createBody.success, createBody.message).toBe(true);
    expect((createBody.data?.channel_id ?? '').trim()).toBe(channelId);

    // LIST → the new snapshot is present; read its id back
    const listRes = await ctx.get(`${CH}/${channelId}/billing/snapshots`);
    const listBody = (await listRes.json()) as Envelope<{ items: SnapshotRow[]; total: number }>;
    expect(listBody.success, listBody.message).toBe(true);
    expect(Array.isArray(listBody.data?.items)).toBe(true);
    const mine = (listBody.data?.items ?? []).find((s) => s.entitlement_name === 'e2e-plan');
    expect(mine, 'the created snapshot appears in the list').toBeTruthy();
    expect(mine!.source_type).toBe('manual');
    expect(typeof listBody.data?.total).toBe('number');
    snapshotId = (mine!.id ?? '').trim();
    expect(snapshotId).not.toBe('');

    // UPDATE → data echoes both ids; the mutated field is persisted
    const updateRes = await ctx.put(`${CH}/${channelId}/billing/snapshots/${snapshotId}`, {
      data: snapshotRequest({ message: 'e2e snapshot (updated)' }),
    });
    const updateBody = (await updateRes.json()) as Envelope<{ channel_id: string; snapshot_id: string }>;
    expect(updateBody.success, updateBody.message).toBe(true);
    expect((updateBody.data?.channel_id ?? '').trim()).toBe(channelId);
    expect((updateBody.data?.snapshot_id ?? '').trim()).toBe(snapshotId);
    const afterUpdate = (await (await ctx.get(`${CH}/${channelId}/billing/snapshots`)).json()) as Envelope<{
      items: SnapshotRow[];
    }>;
    const updated = (afterUpdate.data?.items ?? []).find((s) => (s.id ?? '').trim() === snapshotId);
    expect(updated?.message).toBe('e2e snapshot (updated)');

    // DELETE → data echoes both ids; the snapshot is gone from the list
    const delRes = await ctx.delete(`${CH}/${channelId}/billing/snapshots/${snapshotId}`);
    const delBody = (await delRes.json()) as Envelope<{ channel_id: string; snapshot_id: string }>;
    expect(delBody.success, delBody.message).toBe(true);
    expect((delBody.data?.snapshot_id ?? '').trim()).toBe(snapshotId);
    const afterDelete = (await (await ctx.get(`${CH}/${channelId}/billing/snapshots`)).json()) as Envelope<{
      items: SnapshotRow[];
    }>;
    expect((afterDelete.data?.items ?? []).some((s) => (s.id ?? '').trim() === snapshotId)).toBe(false);
    snapshotId = '';
  } finally {
    if (snapshotId) await ctx.delete(`${CH}/${channelId}/billing/snapshots/${snapshotId}`).catch(() => {});
    if (channelId) await ctx.delete(`${CH}/${channelId}`).catch(() => {});
    await ctx.dispose();
  }
});

// RT-API-074 (P1) — snapshot request validation + channel-not-found.
test("【渠道账务与告警管理 / API】 创建账务快照时校验请求参数，并对不存在的渠道返回错误", async () => {
  skipIfNoService();
  skipIfNoAdminKey();
  const ctx = await adminContext(baseURLFor('router')!);
  const name = `e2e-snap-val-${Date.now()}`;
  let channelId = '';
  try {
    channelId = await createInertChannel(ctx, name);

    // empty purchase currency
    const noCurrency = (await (
      await ctx.post(`${CH}/${channelId}/billing/snapshots`, { data: snapshotRequest({ purchase_currency: '' }) })
    ).json()) as Envelope;
    expect(noCurrency.success).toBe(false);
    expect(noCurrency.message).toBe('采购币种不能为空');

    // non-positive paid amount
    const zeroAmount = (await (
      await ctx.post(`${CH}/${channelId}/billing/snapshots`, { data: snapshotRequest({ purchase_amount: 0 }) })
    ).json()) as Envelope;
    expect(zeroAmount.success).toBe(false);
    expect(zeroAmount.message).toBe('实付金额必须大于 0');

    // no entitlement items
    const noItems = (await (
      await ctx.post(`${CH}/${channelId}/billing/snapshots`, { data: snapshotRequest({ items: [] }) })
    ).json()) as Envelope;
    expect(noItems.success).toBe(false);
    expect(noItems.message).toBe('请至少填写一条权益项');

    // missing channel (valid body so it reaches the channel lookup) → raw gorm message
    const missing = (await (
      await ctx.post(`${CH}/zzz-not-a-channel/billing/snapshots`, { data: snapshotRequest() })
    ).json()) as Envelope;
    expect(missing.success).toBe(false);
    expect(missing.message ?? '').toMatch(/record not found|不存在/);
  } finally {
    if (channelId) await ctx.delete(`${CH}/${channelId}`).catch(() => {});
    await ctx.dispose();
  }
});
