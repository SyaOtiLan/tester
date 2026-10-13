/**
 * router — 渠道告警中心 (channel alert center), admin.
 *
 * Operators watch channel health through an alert feed (billing / circuit /
 * model_disabled / endpoint_disabled) and drive each alert through a simple
 * lifecycle: active → acknowledged → resolved. All endpoints sit under
 * `/api/v1/admin/channel/*` behind `AdminAuth`. This suite covers:
 *
 *   - the read feeds: `/admin/channel/alerts` (paged, with a `summary` block),
 *     `/admin/channel/billing/alerts` (recent, cross-channel) and
 *     `/admin/channel/:id/billing/alerts` (per-channel).
 *   - the acknowledge → resolve state machine and its idempotency;
 *   - request validation (`告警参数无效`).
 *
 * Blast-radius note: acknowledge/resolve is an idempotent upsert keyed on
 * (alert_type, alert_key) (channel_alert_state.go). This suite always uses a
 * SYNTHETIC unique `alert_key` (`e2e-alert-<ts>`) tied to a throwaway inert
 * channel, so it never acknowledges or resolves a REAL operational alert — a
 * genuine alert's key derives from live channel state and will never collide
 * with our timestamped key. There is no delete endpoint for alert-state rows,
 * so each run leaves exactly one self-contained state row keyed to a synthetic
 * alert against a deleted channel; it is inert (no matching alert event ever
 * references it) and harmless, the same way auto-registered identity users
 * accumulate in the identity-login suite.
 *
 * Envelope `{success, message, data}`, HTTP always 200. The `/admin/channel`
 * group auth boundary (normal user 200「权限不足」/ anon 401) is already proven
 * by RT-API-066 (admin-channels.spec) and not re-asserted here.
 *
 * Requires `ROUTER_ADMIN_PRIVATE_KEY`. Verified against router
 * `internal/admin/controller/channel/alert_center.go`, `billing_resource.go`,
 * `internal/admin/model/channel_alert_state.go`,
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

interface AlertState {
  alert_type?: string;
  alert_key?: string;
  channel_id?: string;
  status?: string;
  acknowledged_at?: number;
  acknowledged_by?: string;
  resolved_at?: number;
  resolved_by?: string;
  last_operator_note?: string;
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

// RT-API-075 (P0) — alert read feeds return controlled contracts.
test("【渠道账务与告警管理 / API】 管理员告警信息流和账务告警列表返回分页数据及汇总信息", async () => {
  skipIfNoService();
  skipIfNoAdminKey();
  const ctx = await adminContext(baseURLFor('router')!);
  const name = `e2e-alert-read-${Date.now()}`;
  let channelId = '';
  try {
    // recent alert feed: paged envelope + summary shape
    const feed = (await (await ctx.get(`${CH}/alerts?page=1&page_size=20`)).json()) as Envelope<{
      items: unknown[];
      total: number;
      page: number;
      page_size: number;
      summary?: Record<string, unknown>;
    }>;
    expect(feed.success, feed.message).toBe(true);
    expect(Array.isArray(feed.data?.items)).toBe(true);
    expect(typeof feed.data?.total).toBe('number');
    expect(feed.data?.page).toBe(1);
    expect(feed.data?.page_size).toBe(20);
    if (feed.data?.summary) {
      for (const k of ['total', 'active_total', 'unacknowledged']) {
        expect(feed.data.summary).toHaveProperty(k);
      }
    }

    // cross-channel recent billing alerts: {items,total}
    const billing = (await (await ctx.get(`${CH}/billing/alerts`)).json()) as Envelope<{
      items: unknown[];
      total: number;
    }>;
    expect(billing.success, billing.message).toBe(true);
    expect(Array.isArray(billing.data?.items)).toBe(true);
    expect(typeof billing.data?.total).toBe('number');

    // per-channel billing alerts on a fresh channel → empty page
    channelId = await createInertChannel(ctx, name);
    const perChannel = (await (await ctx.get(`${CH}/${channelId}/billing/alerts`)).json()) as Envelope<{
      items: unknown[];
      total: number;
    }>;
    expect(perChannel.success, perChannel.message).toBe(true);
    expect(perChannel.data?.items).toEqual([]);
    expect(perChannel.data?.total).toBe(0);
  } finally {
    if (channelId) await ctx.delete(`${CH}/${channelId}`).catch(() => {});
    await ctx.dispose();
  }
});

// RT-API-076 (P0) — acknowledge → resolve state machine (idempotent upsert).
test("【渠道账务与告警管理 / API】 管理员可确认并解决告警，重复确认保持幂等", async () => {
  skipIfNoService();
  skipIfNoAdminKey();
  const ctx = await adminContext(baseURLFor('router')!);
  const name = `e2e-alert-sm-${Date.now()}`;
  let channelId = '';
  try {
    channelId = await createInertChannel(ctx, name);
    // Synthetic reference — never collides with a real alert key.
    const ref = { alert_type: 'billing', alert_key: `e2e-alert-${Date.now()}`, channel_id: channelId };

    // acknowledge → status acknowledged, acknowledged_at/by set
    const ackRes = await ctx.post(`${CH}/alerts/acknowledge`, { data: { ...ref, note: 'e2e ack' } });
    const ack = (await ackRes.json()) as Envelope<AlertState>;
    // The alert-state feature needs its own migrated table; when a deployment
    // has not migrated it the handler returns「channel alert state table is not
    // ready」. That is an environment precondition, not a defect — skip cleanly
    // rather than fake a pass (the read feeds in RT-API-075 still run).
    test.skip(
      !ack.success && /table is not ready/.test(ack.message ?? ''),
      'channel_alert_states table is not migrated on this deployment',
    );
    expect(ack.success, ack.message).toBe(true);
    expect(ack.data?.alert_type).toBe('billing');
    expect(ack.data?.alert_key).toBe(ref.alert_key);
    expect(ack.data?.status).toBe('acknowledged');
    expect((ack.data?.acknowledged_at ?? 0)).toBeGreaterThan(0);
    expect((ack.data?.acknowledged_by ?? '').trim()).not.toBe('');
    expect(ack.data?.last_operator_note).toBe('e2e ack');
    const acknowledgedAt = ack.data!.acknowledged_at!;

    // acknowledge again → idempotent success, still acknowledged
    const ackAgain = (await (
      await ctx.post(`${CH}/alerts/acknowledge`, { data: { ...ref, note: 'e2e ack 2' } })
    ).json()) as Envelope<AlertState>;
    expect(ackAgain.success, ackAgain.message).toBe(true);
    expect(ackAgain.data?.status).toBe('acknowledged');

    // resolve → status resolved, resolved_at/by set, acknowledged_at retained
    const resolveRes = await ctx.post(`${CH}/alerts/resolve`, { data: { ...ref, note: 'e2e resolve' } });
    const resolve = (await resolveRes.json()) as Envelope<AlertState>;
    expect(resolve.success, resolve.message).toBe(true);
    expect(resolve.data?.status).toBe('resolved');
    expect((resolve.data?.resolved_at ?? 0)).toBeGreaterThan(0);
    expect((resolve.data?.resolved_by ?? '').trim()).not.toBe('');
    expect((resolve.data?.acknowledged_at ?? 0)).toBeGreaterThanOrEqual(acknowledgedAt);
  } finally {
    if (channelId) await ctx.delete(`${CH}/${channelId}`).catch(() => {});
    await ctx.dispose();
  }
});

// RT-API-077 (P1) — acknowledge/resolve validate the alert reference.
test("【渠道账务与告警管理 / API】 确认并解决拒绝不完整的警报参考（相同参数无效）", async () => {
  skipIfNoService();
  skipIfNoAdminKey();
  const ctx = await adminContext(baseURLFor('router')!);
  try {
    // missing alert_key
    const badAck = (await (
      await ctx.post(`${CH}/alerts/acknowledge`, { data: { alert_type: 'billing', channel_id: 'x', note: '' } })
    ).json()) as Envelope;
    expect(badAck.success).toBe(false);
    expect(badAck.message).toBe('告警参数无效');

    // empty body on resolve
    const badResolve = (await (await ctx.post(`${CH}/alerts/resolve`, { data: {} })).json()) as Envelope;
    expect(badResolve.success).toBe(false);
    expect(badResolve.message).toBe('告警参数无效');
  } finally {
    await ctx.dispose();
  }
});
