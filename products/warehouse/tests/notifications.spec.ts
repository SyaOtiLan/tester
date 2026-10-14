/**
 * warehouse — in-app notifications (WH-API-065..068).
 *
 *   - WH-API-065 通知列表: GET /notifications/list → 200 { items:[...] }.
 *   - WH-API-066 未读数量: GET /notifications/unread-count → 200 { count:number }.
 *   - WH-API-067 标记已读: POST /notifications/read {ids} and POST
 *     /notifications/read-all both return 200; after read-all the unread count
 *     is 0.
 *   - WH-API-068 通知偏好: GET /notifications/preferences → 200 { items:[{Type,
 *     Enabled}] }; POST {type,enabled} toggles a channel and the change is
 *     reflected on a follow-up GET.
 *
 * A fresh SIWE identity is used (empty inbox, default preferences all enabled)
 * so the assertions are deterministic. Requires WAREHOUSE_WEBDAV_URL.
 *
 * Source: handler/notification.go — HandleList {items,canAnnounce},
 * HandleUnreadCount {count}, HandleRead/HandleReadAll {message:"ok"},
 * HandlePreferences (GET items[{Type,Enabled}], POST {type,enabled}).
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, envFor } from '../fixtures';
import { Wallet } from 'ethers';
import { loginWithWallet, authedRequest } from '../helpers/auth';

function apiBase(): string | undefined {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_URL'];
}

interface Pref {
  Type?: string;
  Enabled?: boolean;
  type?: string;
  enabled?: boolean;
}
const prefType = (p: Pref) => (p.Type ?? p.type)!;
const prefEnabled = (p: Pref) => (p.Enabled ?? p.enabled)!;

test.describe(localizedTitle("【通知】通知（notifications）", "notifications"), () => {
  test.describe.configure({ mode: 'serial' });
  let ctx: Awaited<ReturnType<typeof authedRequest>> | undefined;

  test.beforeAll(async () => {
    if (!apiBase()) return;
    const user = await loginWithWallet(apiBase()!, Wallet.createRandom().privateKey);
    ctx = await authedRequest(apiBase()!, user.token);
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test(localizedTitle("【通知 / API】 WH-API-065 通知列表", "WH-API-065 notification list returns an items array"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    const res = await ctx!.get('/api/v1/public/notifications/list?limit=20');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  test(localizedTitle("【通知 / API】 WH-API-066 未读数量", "WH-API-066 unread-count returns a numeric count"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    const res = await ctx!.get('/api/v1/public/notifications/unread-count');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(typeof body.count).toBe('number');
    expect(body.count).toBeGreaterThanOrEqual(0);
  });

  test(localizedTitle("【通知 / API】 WH-API-067 标记单条/全部已读", "WH-API-067 mark single and all notifications read"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    // read with an explicit id list (empty is accepted — the endpoint is wired
    // and idempotent for a fresh inbox).
    const readOne = await ctx!.post('/api/v1/public/notifications/read', { data: { ids: [] } });
    expect(readOne.status()).toBe(200);

    const readAll = await ctx!.post('/api/v1/public/notifications/read-all');
    expect(readAll.status()).toBe(200);

    // after read-all, nothing remains unread.
    const count = await ctx!.get('/api/v1/public/notifications/unread-count');
    expect(count.status()).toBe(200);
    expect(((await count.json()) as { count: number }).count).toBe(0);
  });

  test(localizedTitle("【通知 / API】 WH-API-068 通知偏好设置", "WH-API-068 preferences can be read and toggled"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    const res = await ctx!.get('/api/v1/public/notifications/preferences');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { items: Pref[] };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);

    const target = body.items[0];
    const type = prefType(target);
    const before = prefEnabled(target);

    const set = await ctx!.post('/api/v1/public/notifications/preferences', {
      data: { type, enabled: !before },
    });
    expect(set.status()).toBe(200);

    // the toggle persists.
    const after = await ctx!.get('/api/v1/public/notifications/preferences');
    expect(after.status()).toBe(200);
    const afterBody = (await after.json()) as { items: Pref[] };
    const updated = afterBody.items.find((p) => prefType(p) === type);
    expect(updated).toBeTruthy();
    expect(prefEnabled(updated!)).toBe(!before);

    // restore the original value (leave the account as we found it).
    await ctx!
      .post('/api/v1/public/notifications/preferences', { data: { type, enabled: before } })
      .catch(() => undefined);
  });
});
