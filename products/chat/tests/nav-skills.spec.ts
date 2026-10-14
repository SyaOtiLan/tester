/**
 * chat — sidebar navigation, new-chat, setup gating, help, and skills
 * (CH-017..CH-022, CH-025, CH-027, CH-029).
 *
 * Logged-in cases drive the REAL SIWE flow. In this environment the account has
 * no funded Router token, so the model catalog is empty and the app lands the
 * authorised user on /setup with the sidebar mounted — the true expected state.
 * Cases that require a ready text/image model or a deletable custom skill can't
 * be exercised against an empty catalog and are skipped with that reason.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';
import { loginWithWallet, SIDEBAR } from '../helpers/chat-auth';

function skipIfNoService() {
  test.skip(!baseURLFor('chat'), 'CHAT_BASE_URL not configured');
}

// Login drives a live SIWE + workspace-sync bootstrap; the WebDAV sync step is
// occasionally flaky per fresh wallet, so allow a couple of retries (each retry
// uses a new wallet).
test.describe.configure({ retries: 2 });

// CH-017 — sidebar shows Discovery / NewChat main buttons plus help, settings, account.
test(localizedTitle("【首页导航与路由 / UI】 CH-017 侧栏渲染发现/新建会话/帮助/设置入口", "CH-017 sidebar renders navigation entries"), async ({ page }) => {
  skipIfNoService();
  test.setTimeout(90_000);
  await loginWithWallet(page);
  await expect(page.locator(SIDEBAR).first()).toBeVisible();
  const barButtons = page.locator('[class*="sidebar-bar-button"]');
  await expect(barButtons).toHaveCount(2); // Discovery + NewChat(Session)
  await expect(page.locator('a[href="#/help"]')).toBeVisible();
  await expect(page.locator('a[href="#/settings"]')).toBeVisible();
  await expect(page.locator('[class*="sidebar-title"]').first()).toBeVisible();
});

// CH-018 — clicking the NewChat main button navigates to /new-chat in-SPA.
test(localizedTitle("【首页导航与路由 / UI】 CH-018 点击新建会话进入 /new-chat", "CH-018 new-chat button navigates to /new-chat"), async ({ page }) => {
  skipIfNoService();
  test.setTimeout(90_000);
  await loginWithWallet(page);
  // The second bar button is the NewChat/Session action.
  await page.locator('[class*="sidebar-bar-button"]').nth(1).click();
  await expect.poll(() => page.url(), { timeout: 15_000 }).toMatch(/#\/new-chat/);
  await expect(page.locator('[class*="new-chat"]').first()).toBeVisible();
});

// CH-019 — home auto-redirects to /new-chat when a model is ready but no sessions exist.
test(localizedTitle("【首页导航与路由 / E2E】 CH-019 首页在无会话时自动进入新建会话", "CH-019 empty-session home redirects to /new-chat"), async () => {
  test.skip(
    true,
    'requires a ready text/image model with zero message-bearing sessions; this environment has an empty model catalog (no funded Router token), so Home routes to /setup instead of /new-chat.',
  );
});

// CH-020 — with no usable model, protected navigation is guided to /setup.
test(localizedTitle("【首页导航与路由 / E2E】 CH-020 无可用模型时引导到 Setup 页", "CH-020 no-model navigation is guided to /setup"), async ({ page }) => {
  skipIfNoService();
  test.setTimeout(90_000);
  await loginWithWallet(page);
  await page.goto('/#/chat');
  await expect.poll(() => page.url(), { timeout: 15_000 }).toMatch(/#\/setup/);
  await expect(page.locator('[class*="setup-page"]').first()).toBeVisible();
  await expect(page.locator('[class*="setup-title"]').first()).toBeVisible();
});

// CH-021 — model-load failure shows a Bootstrap error with a retry entry.
test(localizedTitle("【首页导航与路由 / UI】 CH-021 模型加载失败展示重试入口", "CH-021 model-load failure shows retry"), async () => {
  test.skip(
    true,
    "cannot deterministically force Router llm.models() to fail; without a token it returns an empty catalog gracefully (no throw), so the Bootstrap error/retry state never renders. The live Router is up and returns [].",
  );
});

// CH-022 — /help is reachable without logging in.
test(localizedTitle("【首页导航与路由 / UI】 CH-022 帮助页 /help 免登录可访问", "CH-022 help page is accessible without login"), async ({ page }) => {
  skipIfNoService();
  await page.goto('/#/help');
  // Not bounced to /auth (help is an allowed unauth path).
  await expect.poll(() => page.url(), { timeout: 10_000 }).toMatch(/#\/help/);
  // Help renders its header title even for an unauthenticated visitor.
  await expect(page.locator('.window-header-main-title').first()).toBeVisible({ timeout: 15_000 });
});

// CH-025 — new-chat renders the featured-skills area (or its empty state).
test(localizedTitle("【新建对话(new-chat) / UI】 CH-025 精选技能列表渲染", "CH-025 new-chat renders featured skills area"), async ({ page }) => {
  skipIfNoService();
  test.setTimeout(90_000);
  await loginWithWallet(page);
  await page.goto('/#/new-chat');
  await expect(page.locator('[class*="new-chat"]').first()).toBeVisible();
  // Either populated featured masks or the documented empty-skills placeholder.
  const featured = page.locator('[class*="featured-masks"]');
  const empty = page.locator('[class*="empty-skills"]');
  await expect(featured.or(empty).first()).toBeVisible({ timeout: 15_000 });
});

// CH-027 — the "More/All" entry jumps to /discovery?type=skill.
test(localizedTitle("【新建对话(new-chat) / UI】 CH-027 \"更多/探索技能\"跳转发现页", "CH-027 more-skills navigates to discovery"), async ({ page }) => {
  skipIfNoService();
  test.setTimeout(90_000);
  await loginWithWallet(page);
  await page.goto('/#/new-chat');
  await expect(page.locator('[class*="new-chat"]').first()).toBeVisible();
  const more = page.getByRole('button', { name: /All|更多|探索技能/ }).first();
  await more.click();
  await expect.poll(() => page.url(), { timeout: 15_000 }).toMatch(/#\/discovery\?type=skill/);
});

// CH-029 — the Return button navigates back to the home route.
test(localizedTitle("【新建对话(new-chat) / UI】 CH-029 返回按钮回到首页", "CH-029 new-chat return goes home"), async ({ page }) => {
  skipIfNoService();
  test.setTimeout(90_000);
  await loginWithWallet(page);
  await page.goto('/#/new-chat');
  await expect(page.locator('[class*="new-chat"]').first()).toBeVisible();
  await page.getByRole('button', { name: /Return|返回/ }).first().click();
  await expect
    .poll(() => new URL(page.url()).hash, { timeout: 15_000 })
    .toMatch(/^#\/($|setup|new-chat)/); // home resolves to setup here (no model)
});

// CH-023 / CH-024 / CH-026 / CH-028 need a ready model or a deletable custom skill.
test(localizedTitle("【新建对话(new-chat) / E2E】 CH-023 空白会话:输入草稿后开始对话", "CH-023 blank-session draft starts a chat"), async () => {
  test.skip(true, 'starting a chat requires a ready text model; empty catalog routes back to /setup.');
});
test(localizedTitle("【新建对话(new-chat) / UI】 CH-024 新建会话模型下拉选择", "CH-024 new-chat model dropdown selection"), async () => {
  test.skip(true, 'needs multiple available models; catalog is empty (no funded Router token).');
});
test(localizedTitle("【新建对话(new-chat) / E2E】 CH-026 点击精选技能创建对应会话", "CH-026 featured skill creates a session"), async () => {
  test.skip(true, 'creating a session from a skill requires a ready text model; empty catalog routes to /setup.');
});
test(localizedTitle("【新建对话(new-chat) / UI】 CH-028 删除技能卡片", "CH-028 delete a skill card"), async () => {
  test.skip(true, 'needs a deletable custom skill; none exist and none can be created without a model-ready workspace.');
});
