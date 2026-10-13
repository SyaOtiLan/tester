/**
 * node — UI language switch (ND-UI-005).
 *
 * The market header renders a language switcher (`components/common/Language.vue`,
 * trigger `.lang-trigger`) offering 中文 / English. Selecting a locale calls
 * `setLocale`, which swaps the reactive i18n messages, sets
 * `document.documentElement.lang`, and persists the choice to the
 * `i18nextLng` localStorage key. A reload re-reads that key, so the language
 * selection survives.
 *
 * We drive the switch from the market page (guaranteed to mount the header +
 * the bilingual 个人应用/Profile Center developer-entry button and the search
 * placeholder), assert copy flips both directions, and that the choice
 * persists across a reload.
 *
 * Locale strings verified against node `web/src/lang/{zh-CN,en-US}.ts`:
 *   header_dev_center: '个人应用' / 'Profile Center'
 *   header_market_search_placeholder: '搜索应用名称/作者地址' /
 *     'Search app name / author address'
 */
import { test, expect, baseURLFor, envFor } from '../fixtures';

import { seedWalletSession } from '../helpers/session';

function skipIfNoService() {
  test.skip(!baseURLFor('node'), 'NODE_BASE_URL not configured');
}

async function storedLocale(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => (globalThis as any).localStorage.getItem('i18nextLng') ?? '');
}

test("【前端首页与导航 / UI】 ND-UI-005 界面语言切换(i18n)", async ({
  page,
  recorder,
}) => {
  skipIfNoService();
  const env = envFor('node');
  test.skip(!env['NODE_WALLET_PRIVATE_KEY'], 'NODE_WALLET_PRIVATE_KEY not configured');
  const baseURL = baseURLFor('node')!;

  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await seedWalletSession(page, baseURL, env['NODE_WALLET_PRIVATE_KEY']!);
  await page.goto(`${baseURL}/market`, { waitUntil: 'domcontentloaded' });

  const devEntry = page.locator('.dev-entry-btn');
  const searchInput = page.locator('.market-search input');
  const langTrigger = page.locator('.lang-trigger');

  // Default locale is zh-CN.
  await expect(devEntry).toHaveText('个人应用', { timeout: 15_000 });
  await expect(searchInput).toHaveAttribute('placeholder', '搜索应用名称/作者地址');
  await recorder.step(page, '默认中文');

  // Switch to English.
  await langTrigger.click();
  await page.getByRole('menuitem', { name: 'English' }).click();
  await expect(devEntry).toHaveText('Profile Center');
  await expect(searchInput).toHaveAttribute('placeholder', 'Search app name / author address');
  expect(await storedLocale(page)).toBe('en-US');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en-US');
  await recorder.step(page, '切换为 English');

  // The selection survives a reload.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(devEntry).toHaveText('Profile Center', { timeout: 15_000 });
  expect(await storedLocale(page)).toBe('en-US');
  await recorder.step(page, '刷新后仍为 English');

  // Switch back to 中文 (the other direction).
  await langTrigger.click();
  await page.getByRole('menuitem', { name: '中文' }).click();
  await expect(devEntry).toHaveText('个人应用');
  expect(await storedLocale(page)).toBe('zh-CN');
  await recorder.step(page, '切回中文');
});
