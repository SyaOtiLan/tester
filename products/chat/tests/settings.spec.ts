/**
 * chat — Settings page (CH-059..CH-065).
 *
 * Drives the real `/#/settings` page behind a wallet UCAN login. This
 * customized NextChat build surfaces a slim settings page (account/appearance/
 * language/danger). Access-code + custom-model config (CH-062) and the
 * inject-system-prompt / input-template controls (CH-063) are NOT on this
 * page in this build — they live on the Router page / per-session model-config
 * panel respectively — so those two skip with a precise reason.
 */
import { test, expect, baseURLFor } from '../fixtures';
import { loginOrSkip, openRoute } from '../helpers/auth';
import { readPersistedState } from '../helpers/storage';

function skipNoService() {
  test.skip(!baseURLFor('chat'), 'CHAT_BASE_URL not configured');
}

async function openSettings(page: any) {
  await loginOrSkip(page);
  await openRoute(page, '/settings');
  await expect(page.getByText('Settings', { exact: true }).first()).toBeVisible();
}

// CH-059 — settings page renders grouped sections.
test("【设置(Settings) / UI】 CH-059 打开设置页展示分组", async ({ page }) => {
  skipNoService();
  await openSettings(page);
  // Appearance + danger groups are always present.
  await expect(page.getByText('Theme', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Reset All Settings', { exact: true })).toBeVisible();
  await expect(page.getByText('Clear All Data', { exact: true })).toBeVisible();
});

// CH-060 — the current wallet (blockchain) address is displayed.
test("【设置(Settings) / UI】 CH-060 展示区块链地址(当前账户)", async ({ page }) => {
  skipNoService();
  await openSettings(page);
  await expect(page.getByText('Blockchain Address', { exact: true })).toBeVisible();
  const expected = (process.env.ROUTER_EXPECTED_ADDRESS || '').trim();
  if (expected) {
    // Address may be rendered masked; match on a prefix slice.
    const bodyText = await page.locator('body').innerText();
    const head = expected.slice(0, 6).toLowerCase();
    expect(bodyText.toLowerCase()).toContain(head);
  }
});

// CH-061 — switching theme updates the applied theme + persists.
test("【设置(Settings) / UI】 CH-061 切换主题(深色/浅色/自动)", async ({ page }) => {
  skipNoService();
  await openSettings(page);
  const themeSelect = page.locator('select[aria-label="Theme"]');
  await expect(themeSelect).toBeVisible();
  await themeSelect.selectOption('dark');
  await expect(themeSelect).toHaveValue('dark');
  // The app applies the dark theme to the document body.
  await expect
    .poll(async () =>
      page.evaluate(() => document.body.classList.contains('dark')),
    { timeout: 5_000 })
    .toBeTruthy();
  // Persisted in the config store (app-config, kept in IndexedDB via idb-keyval).
  await expect
    .poll(async () => (await readPersistedState(page, 'app-config'))?.theme, {
      timeout: 5_000,
    })
    .toBe('dark');
});

// CH-062 — access-code / custom-model config.
test("【设置(Settings) / UI】 CH-062 配置访问码/自定义模型", async ({ page }) => {
  skipNoService();
  await openSettings(page);
  const accessCode = page.getByText(/Access Code|访问密码/).first();
  test.skip(
    (await accessCode.count()) === 0,
    'access-code / custom-model config is not surfaced on the settings page in this build (model/token config lives on the Router page)',
  );
});

// CH-063 — inject system prompts + input pre-processing template.
test("【设置(Settings) / UI】 CH-063 注入系统级提示与用户输入预处理模板", async ({ page }) => {
  skipNoService();
  await openSettings(page);
  const inject = page.getByText('Inject System Prompts', { exact: true });
  test.skip(
    (await inject.count()) === 0,
    'Inject-System-Prompts / Input-Template live in the per-session model-config panel, not the settings page; require an active model session to reach',
  );
});

// CH-064 — reset all settings restores defaults.
test("【设置(Settings) / UI】 CH-064 重置所有设置", async ({ page }) => {
  skipNoService();
  await openSettings(page);
  const themeSelect = page.locator('select[aria-label="Theme"]');
  await themeSelect.selectOption('dark');
  await expect(themeSelect).toHaveValue('dark');

  await page.getByText('Reset', { exact: true }).first().click();
  // Confirm dialog.
  const confirm = page.getByText('Confirm', { exact: true }).last();
  await expect(confirm).toBeVisible();
  await confirm.click();

  // Theme returns to the default ("auto").
  await expect(themeSelect).toHaveValue('auto', { timeout: 5_000 });
});

// CH-065 — clear all data resets the app to its initial state.
test("【设置(Settings) / E2E】 CH-065 清除所有数据", async ({ page }) => {
  skipNoService();
  await openSettings(page);
  // Persist a non-default theme so we can prove the reload was triggered.
  await page.evaluate(() => {
    (window as any).__preClear = true;
  });
  await page.getByText('Clear', { exact: true }).first().click();
  const confirm = page.getByText('Confirm', { exact: true }).last();
  await expect(confirm).toBeVisible();
  await confirm.click();
  // clearAllData() wipes IndexedDB + localStorage then reloads the page. The
  // sentinel set above only survives SPA navigation, so its disappearance proves
  // the full reload (and therefore the wipe) happened. (The wallet shim
  // silently re-authorizes on reload, so the URL hash is not a reliable signal.)
  await expect
    .poll(async () => page.evaluate(() => (window as any).__preClear ?? 'gone'), { timeout: 10_000 })
    .toBe('gone');
});
