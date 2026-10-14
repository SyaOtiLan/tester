/**
 * chat — session management (CH-043..CH-050).
 *
 * The workspace bootstraps with a single default session ("通用问答"). Creating
 * additional message-bearing sessions requires a usable model, which is absent
 * here (empty Router catalog, no provider key). So list/switch, search, and
 * persistence are exercised REALLY with the default session; multi-session
 * create/delete/rename/pin/summary/import are skipped with their reasons.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';
import { loginWithWallet, waitForSidebar, SIDEBAR } from '../helpers/chat-auth';

function skipIfNoService() {
  test.skip(!baseURLFor('chat'), 'CHAT_BASE_URL not configured');
}

// Login drives a live SIWE + workspace-sync bootstrap; the WebDAV sync step is
// occasionally flaky per fresh wallet, so allow a couple of retries (each retry
// uses a new wallet).
test.describe.configure({ retries: 2 });

// CH-043 — the sidebar session list renders items with title and message-count subtitle.
test(localizedTitle("【会话管理 / UI】 CH-043 会话列表展示与切换", "CH-043 session list renders with count subtitle"), async ({ page }) => {
  skipIfNoService();
  test.setTimeout(90_000);
  await loginWithWallet(page);
  await expect(page.locator(SIDEBAR).first()).toBeVisible();
  const items = page.locator('[class*="chat-item"]');
  await expect(items.first()).toBeVisible({ timeout: 15_000 });
  expect(await items.count()).toBeGreaterThanOrEqual(1);
  await expect(page.locator('[class*="chat-item-title"]').first()).toBeVisible();
  // Subtitle "N messages" (Locale.ChatItem.ChatItemCount).
  await expect(page.locator('[class*="chat-item-count"]').first()).toBeVisible();
});

// CH-048 — /search-chat renders the search UI and accepts a query.
test(localizedTitle("【会话管理 / UI】 CH-048 搜索会话 /search-chat", "CH-048 search-chat page accepts a query"), async ({ page }) => {
  skipIfNoService();
  test.setTimeout(90_000);
  await loginWithWallet(page);
  await page.goto('/#/search-chat');
  const bar = page.locator('input[class*="search-bar"]');
  await expect(bar).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.window-header-main-title')).toBeVisible();
  await bar.fill('hello');
  // No crash and the query is retained.
  await expect(bar).toHaveValue('hello');
});

// CH-049 — sessions persist across a reload (chat-next-web-store).
test(localizedTitle("【会话管理 / E2E】 CH-049 会话持久化(刷新后恢复)", "CH-049 sessions persist across reload"), async ({ page }) => {
  skipIfNoService();
  test.setTimeout(90_000);
  await loginWithWallet(page);
  await expect(page.locator(SIDEBAR).first()).toBeVisible();
  const items = page.locator('[class*="chat-item"]');
  await expect(items.first()).toBeVisible({ timeout: 15_000 });
  const before = await items.count();
  expect(before).toBeGreaterThanOrEqual(1);
  await page.reload();
  await waitForSidebar(page);
  await expect
    .poll(() => page.locator('[class*="chat-item"]').count(), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(before);
});

// The following need a second/model-backed session or a feature that isn't present.
test(localizedTitle("【会话管理 / E2E】 CH-044 新建并删除会话", "CH-044 create and delete a session"), async () => {
  test.skip(
    true,
    'creating a real session requires a usable model; the workspace resets to a single default session offline, so create+delete cannot be exercised deterministically.',
  );
});
test(localizedTitle("【会话管理 / UI】 CH-045 修改会话标题", "CH-045 rename a session title"), async () => {
  test.skip(true, 'the session-title edit UI is only reachable inside the model-gated chat view; no model available.');
});
test(localizedTitle("【会话管理 / UI】 CH-046 刷新/自动生成标题", "CH-046 refresh / auto-generate title"), async () => {
  test.skip(true, 'needs AutoGenerateTitle with a live model (SUMMARIZE/text model) and session content.');
});
test(localizedTitle("【会话管理 / UI】 CH-047 会话置顶/取消置顶", "CH-047 pin / unpin a session"), async () => {
  test.skip(
    true,
    'no session-level pin feature exists in this build — the Pin action is message-level (Chat.Actions.Pin), not a sidebar session pin. Flagged as a product gap vs. the case spec.',
  );
});
test(localizedTitle("【会话管理 / E2E】 CH-050 会话数据导入/合并", "CH-050 import / merge session data"), async () => {
  test.skip(
    true,
    'no local session-import UI in this build; session import/merge happens only via WebDAV cloud-sync, which needs a configured+ready sync backend and account data.',
  );
});
