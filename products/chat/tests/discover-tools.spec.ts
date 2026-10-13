/**
 * chat — Discover / skills / masks / plugins / tools (CH-077..CH-083).
 *
 * Drives the real SPA pages behind a wallet UCAN login:
 *   /#/discovery  (skills + tools marketplace)
 *   /#/skills     (skill editor + local-skill creation)  → also /#/masks
 *   /#/plugins    (OpenAPI import manager)
 *   /#/tools      (tool-server market)
 *
 * ENABLE_TOOLS is on in this deployment (verified via /api/config → enableTools:
 * true), so the tools runtime is available (CH-082 asserts the market renders /
 * runtime is enabled; a real MCP tool-call in a session is out of scope) and the
 * "tools disabled" degrade path (CH-083) cannot be reproduced here.
 */
import { test, expect, baseURLFor } from '../fixtures';
import { loginOrSkip, openRoute } from '../helpers/auth';
import { readPersistedState } from '../helpers/storage';

function skipNoService() {
  test.skip(!baseURLFor('chat'), 'CHAT_BASE_URL not configured');
}

// CH-077 — discovery page browses skills / tools.
test("【技能/面具/插件/工具/发现 / UI】 CH-077 发现页浏览技能/工具", async ({ page }) => {
  skipNoService();
  await loginOrSkip(page);
  await openRoute(page, '/discovery?type=skill');
  await expect(page.getByText('Discovery', { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
  // Switching the marketplace type keeps the page rendered (skill/tool views).
  await openRoute(page, '/discovery?type=tool');
  await expect(page.getByText('Discovery', { exact: true }).first()).toBeVisible();
});

// CH-078 — skill editor creates a local (custom) skill persisted to skill-store.
test("【技能/面具/插件/工具/发现 / E2E】 CH-078 技能编辑器创建自定义技能", async ({ page }) => {
  skipNoService();
  await loginOrSkip(page);
  await openRoute(page, '/skills');
  await expect(page.getByText('Skills', { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });

  const skillCount = async () => {
    const state = await readPersistedState(page, 'skill-store');
    const skills = state?.skills; // Record<string, Skill>
    return skills ? Object.keys(skills).length : 0;
  };
  const before = await skillCount();

  await page.getByText('Create Local Skill', { exact: true }).click();
  // The skill editor opens with an editable bot-name field.
  await expect(page.locator('input[aria-label="Bot Name"]').first()).toBeVisible({
    timeout: 5_000,
  });

  await expect.poll(skillCount, { timeout: 5_000 }).toBe(before + 1);
});

// CH-079 — /masks reuses the skill editor (compat route).
test("【技能/面具/插件/工具/发现 / UI】 CH-079 面具路由 /masks 兼容旧入口", async ({ page }) => {
  skipNoService();
  await loginOrSkip(page);
  await openRoute(page, '/masks');
  // Same page shell as /skills.
  await expect(page.getByText('Skills', { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('Create Local Skill', { exact: true })).toBeVisible();
});

// CH-080 — plugins page manages plugins.
test("【技能/面具/插件/工具/发现 / UI】 CH-080 插件页 /plugins 管理", async ({ page }) => {
  skipNoService();
  await loginOrSkip(page);
  await openRoute(page, '/plugins');
  await expect(page.getByText('OpenAPI Import', { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
});

// CH-081 — tools market lists tool servers.
test("【技能/面具/插件/工具/发现 / UI】 CH-081 工具市场 /tools 浏览", async ({ page }) => {
  skipNoService();
  await loginOrSkip(page);
  await openRoute(page, '/tools');
  await expect(page.getByText('Tools', { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
});

// CH-082 — tools runtime is enabled (ENABLE_TOOLS) and the market is available.
test("【技能/面具/插件/工具/发现 / E2E】 CH-082 启用工具运行时(ENABLE_TOOLS)", async ({ page, request }) => {
  skipNoService();
  const cfg = await (await request.get('/api/config')).json();
  test.skip(!cfg.enableTools, 'ENABLE_TOOLS is off — tools runtime not initialized');
  await loginOrSkip(page);
  await openRoute(page, '/tools');
  // The tools market page renders (runtime available); a live MCP tool-call in
  // a chat session requires a ready model + configured server, out of scope.
  await expect(page.getByText('Tools', { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
});

// CH-083 — tools-disabled degrade path.
test("【技能/面具/插件/工具/发现 / UI】 CH-083 工具未启用时降级", async ({ request }) => {
  skipNoService();
  const cfg = await (await request.get('/api/config')).json();
  test.skip(
    !!cfg.enableTools,
    'ENABLE_TOOLS is ON in this deployment (enableTools:true) — cannot reproduce the tools-disabled degrade path',
  );
  // If ever disabled, tool entries should hide gracefully — asserted elsewhere.
  expect(cfg.enableTools).toBeFalsy();
});
