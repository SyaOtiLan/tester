/**
 * router — authenticated workspace navigation & read surfaces
 * (RT-UI-011 / 012 / 015 / 019 / 020).
 *
 * All seed a real SIWE wallet session via `seedWalletSession`. The UI language
 * follows the browser locale (en-US in headless Chromium → English labels; the
 * zh fallback is also accepted), so text assertions match either language.
 *
 * Selectors verified against router web/src: AdminSidebar (`.router-admin-nav-menu`
 * — note `.router-user-nav-menu` in the doc is orphaned/unmounted, the live
 * layout renders AdminSidebar), Header language dropdown, UserWorkspaceEntryRedirect,
 * WorkspaceModels, and TopUp/QuotaPage.
 */
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { seedWalletSession } from '../helpers/session';

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}

async function seed(page: import('@playwright/test').Page, baseURL: string) {
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await seedWalletSession(page, baseURL, envFor('router')['ROUTER_WALLET_PRIVATE_KEY']!);
}

// RT-UI-011 (P2)
test("【管理后台与工作台 / UI】 经过身份验证的侧边栏导航呈现分组的菜单项", async ({
  page,
  baseURL,
  recorder,
}) => {
  skipIfNoService();
  test.skip(!envFor('router')['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');
  await seed(page, baseURL!);

  await page.goto(`${baseURL}/workspace/token`, { waitUntil: 'domcontentloaded' });
  // The live UserWorkspaceLayout renders AdminSidebar → `.router-admin-nav-menu`.
  const nav = page.locator('.router-admin-nav-menu');
  await expect(nav).toBeVisible({ timeout: 15_000 });
  // A normal-user session renders the flat workspace menu (buildUserWorkspaceMenuItems):
  // 可用模型 / 令牌 / 我的供应商 / 额度. Account & log moved to the header avatar dropdown.
  for (const label of [/可用模型|Available Models/, /令牌|Token/, /我的供应商|My providers/, /额度|Quota/]) {
    await expect(nav.getByText(label).first()).toBeVisible();
  }
  await recorder.step(page, '已鉴权侧栏导航分组');
});

// RT-UI-012 (P2)
test("【管理后台与工作台 / UI】 标题语言下拉菜单切换 UI 语言", async ({ page, baseURL, recorder }) => {
  skipIfNoService();
  test.skip(!envFor('router')['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');
  await seed(page, baseURL!);
  await page.goto(`${baseURL}/workspace/token`, { waitUntil: 'domcontentloaded' });

  const nav = page.locator('.router-admin-nav-menu');
  await expect(nav).toBeVisible({ timeout: 15_000 });

  // Open the language dropdown (first `.router-header-dropdown`, the one holding
  // the language icon; the second is the user chip) and switch to the *other*
  // language, then assert a known nav label flips accordingly.
  const langTrigger = page.locator('.router-header-dropdown').first();
  await langTrigger.click();

  // Read the current Token label to decide which way to switch.
  const tokenItem = nav.getByText(/令牌|Token/).first();
  const before = (await tokenItem.textContent())?.trim() ?? '';
  const switchToChinese = /Token/i.test(before) && !/令牌/.test(before);
  await page
    .getByText(switchToChinese ? '中文' : 'English', { exact: true })
    .first()
    .click();

  if (switchToChinese) {
    await expect(nav.getByText('令牌').first()).toBeVisible({ timeout: 10_000 });
  } else {
    await expect(nav.getByText(/Token/).first()).toBeVisible({ timeout: 10_000 });
  }
  await recorder.step(page, '语言切换生效');
});

// RT-UI-015 (P2)
test("【管理后台与工作台 / UI】 /workspace/条目按余额/包重定向", async ({ page, baseURL, recorder }) => {
  skipIfNoService();
  test.skip(!envFor('router')['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');
  await seed(page, baseURL!);

  await page.goto(`${baseURL}/workspace/entry`, { waitUntil: 'domcontentloaded' });
  // UserWorkspaceEntryRedirect: no active package AND zero balance → pricing;
  // an active package OR balance>0 → topup?tab=quota. Either landing is a valid
  // resolution of the redirect.
  await expect(page).toHaveURL(/\/workspace\/(service\/pricing|topup\?tab=quota)/, {
    timeout: 15_000,
  });
  // This account has package/balance, so it resolves to the quota branch.
  await expect(page).toHaveURL(/\/workspace\/topup\?tab=quota/, { timeout: 15_000 });
  await recorder.step(page, 'workspace/entry 依据余额重定向');
});

// RT-UI-019 (P2)
test("【管理后台与工作台 / UI】 模型页面呈现可用模型标签（或空状态）", async ({
  page,
  baseURL,
  recorder,
}) => {
  skipIfNoService();
  test.skip(!envFor('router')['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');
  await seed(page, baseURL!);

  await page.goto(`${baseURL}/workspace/service/models`, { waitUntil: 'domcontentloaded' });
  // The refresh button always renders (independent of the model fetch).
  await expect(page.locator('.workspace-models-refresh')).toBeVisible({ timeout: 15_000 });
  // Models are shown as `.router-tag` chips; when the catalogue is empty a
  // friendly empty-state renders instead. Accept either.
  const tags = page.locator('.router-tag');
  const empty = page.locator('.workspace-models-empty');
  await expect(async () => {
    const [t, e] = await Promise.all([tags.count(), empty.count()]);
    expect(t > 0 || e > 0).toBe(true);
  }).toPass({ timeout: 15_000 });
  await recorder.step(page, '模型页渲染可用模型标签');
});

// RT-UI-020 (P2)
test("【管理后台与工作台 / UI】 配额页面显示支出日历", async ({ page, baseURL, recorder }) => {
  skipIfNoService();
  test.skip(!envFor('router')['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');
  await seed(page, baseURL!);

  await page.goto(`${baseURL}/workspace/topup?tab=quota`, { waitUntil: 'domcontentloaded' });
  // QuotaPage renders SpendingCalendar inside `.dashboard-spend-stack`, itself
  // inside `.dashboard-spend-section`.
  await expect(page.locator('.dashboard-spend-section')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.dashboard-spend-stack')).toBeVisible({ timeout: 15_000 });
  await recorder.step(page, '额度总览页展示消费日历');
});
