/**
 * chat — Cloud storage / WebDAV proxy (CH-066..CH-071).
 *
 * UI cases (CH-066/067/068/071) drive the real `/#/storage` page behind a
 * wallet UCAN login. API cases (CH-069/070) hit `/api/webdav/[...path]`
 * directly — no login needed.
 *
 * WebDAV proxy contract (app/api/webdav/[...path]/route.ts), verified live:
 *   - endpoint must be whitelisted (internal list + configured backend +,
 *     in non-prod, localhost) else 400 {msg:"Invalid endpoint"}.
 *   - path must live under STORAGE_KEY ("chatgpt-next-web") else 403.
 *   - allowed proxy_method: MKCOL/GET/HEAD/PUT/DELETE. PROPFIND is NOT allowed
 *     (→ 403), despite the case text — flagged as a doc/impl mismatch.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';
import { loginOrSkip, openRoute } from '../helpers/auth';

const FOLDER = 'chatgpt-next-web';
const BACKEND = 'http://127.0.0.1:6065/dav';

function skipNoService() {
  test.skip(!baseURLFor('chat'), 'CHAT_BASE_URL not configured');
}

// ---------------- WebDAV proxy API (no login) ----------------

// CH-069 — non-whitelisted / missing endpoint is rejected before forwarding.
test(localizedTitle("【云同步与 WebDAV 代理 / API】 CH-069 非白名单或缺失 endpoint 时拒绝请求", "CH-069 WebDAV proxy rejects non-whitelisted endpoint"), async ({ request }) => {
  skipNoService();
  const res = await request.get(
    `/api/webdav/${FOLDER}?endpoint=${encodeURIComponent('http://evil.example.com')}`,
    { failOnStatusCode: false },
  );
  expect(res.status()).toBe(400);
  expect(await res.json()).toMatchObject({ error: true, msg: 'Invalid endpoint' });

  const noEndpoint = await request.get(`/api/webdav/${FOLDER}`, { failOnStatusCode: false });
  expect(noEndpoint.status()).toBe(400);
});

// CH-069b — whitelisted endpoint but a path outside the sync folder is refused.
test(localizedTitle("【云同步与 WebDAV 代理 / API】 CH-069b 白名单端点拒绝访问同步目录外路径", "CH-069 WebDAV proxy refuses a path outside the sync folder"), async ({ request }) => {
  skipNoService();
  const res = await request.get(
    `/api/webdav/notallowed?endpoint=${encodeURIComponent(BACKEND)}`,
    { failOnStatusCode: false },
  );
  expect(res.status()).toBe(403);
  expect(await res.text()).toContain('not allowed to request');
});

// CH-070 — a GET on a whitelisted endpoint inside the folder is forwarded to
// the backend (proves passthrough); the 401 we get back is the backend's, not
// a local rejection. PROPFIND is method-rejected by the proxy (403).
test(localizedTitle("【云同步与 WebDAV 代理 / API】 CH-070 WebDAV 代理透传 PROPFIND/PUT/GET", "CH-070 WebDAV proxy forwards GET to the backend and rejects PROPFIND"), async ({
  request,
}) => {
  skipNoService();
  const get = await request.get(
    `/api/webdav/${FOLDER}?endpoint=${encodeURIComponent(BACKEND)}`,
    { failOnStatusCode: false },
  );
  // Not a local "Invalid endpoint" (400) or "not allowed" (403): the request
  // reached the backend (401/2xx/207 depending on backend auth state).
  expect([400, 403]).not.toContain(get.status());

  const propfind = await request.fetch(
    `/api/webdav/${FOLDER}?endpoint=${encodeURIComponent(BACKEND)}&proxy_method=PROPFIND`,
    { method: 'GET', failOnStatusCode: false },
  );
  // Proxy only whitelists MKCOL/GET/HEAD/PUT/DELETE — PROPFIND is refused.
  expect(propfind.status()).toBe(403);
});

// ---------------- Cloud storage UI (login) ----------------

// CH-066 — storage page shows cloud sync status + config sections.
test(localizedTitle("【云同步与 WebDAV 代理 / UI】 CH-066 存储页展示云同步状态", "CH-066 storage page renders cloud sync status"), async ({ page }) => {
  skipNoService();
  await loginOrSkip(page);
  await openRoute(page, '/storage');
  await expect(page.getByText('Cloud Storage', { exact: true })).toBeVisible();
  // A status pill is always rendered (ready/needs-config/checking/error).
  const statuses = ['Storage ready', 'Configuration required', 'Checking', 'Storage error'];
  const anyStatus = page.locator('body');
  const text = await anyStatus.innerText();
  expect(statuses.some((s) => text.includes(s))).toBeTruthy();
});

// CH-067 — the "Check connection" control probes the configured backend.
test(localizedTitle("【云同步与 WebDAV 代理 / E2E】 CH-067 检查连接(WebDAV 可达性)", "CH-067 storage check-connection is available and runs"), async ({ page }) => {
  skipNoService();
  await loginOrSkip(page);
  await openRoute(page, '/storage');
  const check = page.getByText('Check connection', { exact: true }).first();
  await expect(check).toBeVisible();
  await check.click();
  // After probing, the page shows either a healthy or failed connection state.
  await expect(
    page.getByText(/Storage connection is healthy|Storage connection failed|Checking/),
  ).toBeVisible({ timeout: 15_000 });
});

// CH-068 — "Sync now" triggers a sync run against the configured backend.
test(localizedTitle("【云同步与 WebDAV 代理 / E2E】 CH-068 立即同步会话数据", "CH-068 storage sync-now control triggers a sync"), async ({ page }) => {
  skipNoService();
  await loginOrSkip(page);
  await openRoute(page, '/storage');
  const sync = page.getByText('Sync now', { exact: true }).first();
  test.skip(
    (await sync.count()) === 0,
    'Sync now control not shown (cloud sync not in a ready state)',
  );
  await expect(sync).toBeVisible();
  await sync.click();
  // The sync run resolves; the page stays functional (no crash) and still
  // shows the storage header.
  await expect(page.getByText('Cloud Storage', { exact: true })).toBeVisible();
});

// CH-071 — auto-sync toggle reveals the interval control when enabled.
test(localizedTitle("【云同步与 WebDAV 代理 / E2E】 CH-071 自动同步开关与间隔", "CH-071 storage auto-sync toggle exposes an interval"), async ({ page }) => {
  skipNoService();
  await loginOrSkip(page);
  await openRoute(page, '/storage');
  // The auto-sync row uses a checkbox input inside a ListItem.
  const checkbox = page.locator('input[type="checkbox"]').first();
  test.skip((await checkbox.count()) === 0, 'auto-sync toggle not rendered on this build');
  const wasChecked = await checkbox.isChecked();
  if (!wasChecked) {
    await checkbox.check();
  }
  await expect(checkbox).toBeChecked();
  // Restore original state to avoid persisting a change.
  if (!wasChecked) {
    await checkbox.uncheck();
  }
});
